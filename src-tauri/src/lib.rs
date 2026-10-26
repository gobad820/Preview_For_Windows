use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;

/// Per-process state shared by commands.
#[derive(Default)]
struct Shell {
    /// "mica" when the main window got the Mica backdrop, otherwise "none".
    material: Mutex<String>,
    /// Clipboard sequence number right after this window last put pages on the clipboard.
    clipboard_seq: Mutex<Option<u32>>,
}

/// Reads a file and returns its raw bytes (zero-copy IPC response).
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Writes the raw request body to the URI-encoded path in the `x-path` header, atomically:
/// the bytes go to a temporary file next to the target, which then replaces it.
#[tauri::command]
async fn write_file(request: Request<'_>) -> Result<(), String> {
    let data = raw_body(&request)?;
    let path = header_path(&request)?;
    tauri::async_runtime::spawn_blocking(move || atomic_write(&path, &data))
        .await
        .map_err(|e| e.to_string())?
}

/// Puts the PDF in the request body on the clipboard as a file, like Explorer's Copy.
#[tauri::command]
async fn clipboard_write_pdf(
    request: Request<'_>,
    shell: tauri::State<'_, Shell>,
) -> Result<(), String> {
    let data = raw_body(&request)?;
    let seq = tauri::async_runtime::spawn_blocking(move || clipboard::write_pdf(&data))
        .await
        .map_err(|e| e.to_string())??;
    *shell.clipboard_seq.lock().map_err(|e| e.to_string())? = seq;
    Ok(())
}

/// PDF files on the clipboard; `None` while the clipboard still holds this window's own copy.
#[tauri::command]
async fn clipboard_read_pdf_paths(
    shell: tauri::State<'_, Shell>,
) -> Result<Option<Vec<String>>, String> {
    let own = *shell.clipboard_seq.lock().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || clipboard::read_pdf_paths(own))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens `path` in a new Preview window (a new process, like double-clicking the file).
#[tauri::command]
fn open_window(path: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn window_material(shell: tauri::State<'_, Shell>) -> String {
    shell
        .material
        .lock()
        .map(|m| m.clone())
        .unwrap_or_else(|_| "none".into())
}

/// First command-line argument that names an existing file, as a clean absolute path.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .map(|p| clean_path(&p))
}

/// Absolute path as the user would write it: no symlink resolution and no `\\?\` prefix,
/// so UNC shares and mapped drives stay readable and key the same per-file state as the
/// dialog and drag-drop paths do.
fn clean_path(p: &Path) -> String {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    let s = abs.to_string_lossy().into_owned();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return rest.to_owned();
    }
    s
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("expected raw bytes".into()),
    }
}

fn header_path(request: &Request<'_>) -> Result<PathBuf, String> {
    let value = request
        .headers()
        .get("x-path")
        .ok_or("missing x-path header")?
        .to_str()
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(percent_decode(value)?))
}

/// Decodes `encodeURIComponent` output.
fn percent_decode(s: &str) -> Result<String, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let name = path
        .file_name()
        .ok_or_else(|| format!("not a file path: {}", path.display()))?;
    let mut tmp_name = name.to_os_string();
    tmp_name.push(".preview-tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    // std::fs::rename replaces an existing target on Windows (MoveFileExW + REPLACE_EXISTING).
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(windows)]
mod clipboard {
    use clipboard_win::{formats, get_clipboard, options, raw, Clipboard};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    pub fn write_pdf(data: &[u8]) -> Result<Option<u32>, String> {
        let root = std::env::temp_dir().join("Preview Clipboard");
        prune(&root);
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let dir = root.join(millis.to_string());
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join("Copied Pages.pdf");
        std::fs::write(&file, data).map_err(|e| e.to_string())?;
        let path = file.to_string_lossy().into_owned();
        let _open = Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
        raw::set_file_list_with(&[path.as_str()], options::DoClear).map_err(|e| e.to_string())?;
        Ok(raw::seq_num().map(|n| n.get()))
    }

    pub fn read_pdf_paths(own_seq: Option<u32>) -> Result<Option<Vec<String>>, String> {
        let now = raw::seq_num().map(|n| n.get());
        if own_seq.is_some() && now == own_seq {
            return Ok(None);
        }
        let files: Vec<String> = get_clipboard(formats::FileList).unwrap_or_default();
        Ok(Some(
            files
                .into_iter()
                .filter(|f| f.to_lowercase().ends_with(".pdf"))
                .collect(),
        ))
    }

    /// Removes clipboard folders older than a day.
    fn prune(root: &std::path::Path) {
        let Ok(entries) = std::fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            let old = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > Duration::from_secs(24 * 3600));
            if old {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

#[cfg(not(windows))]
mod clipboard {
    pub fn write_pdf(_data: &[u8]) -> Result<Option<u32>, String> {
        Err("clipboard files are only supported on Windows".into())
    }
    pub fn read_pdf_paths(_own_seq: Option<u32>) -> Result<Option<Vec<String>>, String> {
        Ok(Some(Vec::new()))
    }
}

/// Mica on Windows 11 (build 22000+); an opaque background matching the theme elsewhere.
fn apply_backdrop(window: &tauri::WebviewWindow) -> &'static str {
    #[cfg(windows)]
    {
        if windows_version::OsVersion::current().build >= 22000 {
            let effects = tauri::window::EffectsBuilder::new()
                .effect(tauri::window::Effect::Mica)
                .build();
            if window.set_effects(effects).is_ok() {
                return "mica";
            }
        }
    }
    let dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    let color = if dark {
        tauri::window::Color(30, 30, 30, 255)
    } else {
        tauri::window::Color(232, 232, 232, 255)
    };
    let _ = window.set_background_color(Some(color));
    "none"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Shell::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let material = apply_backdrop(&window);
                if let Ok(mut m) = app.state::<Shell>().material.lock() {
                    *m = material.to_string();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            clipboard_write_pdf,
            clipboard_read_pdf_paths,
            open_window,
            window_material,
            startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Preview");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_uri_components() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5C%ED%95%9C%EA%B8%80.pdf").unwrap(),
            r"C:\Users\한글.pdf"
        );
        assert_eq!(percent_decode("plain").unwrap(), "plain");
        assert!(percent_decode("%E0%A4").is_err());
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let dir = std::env::temp_dir().join(format!("pfw-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.pdf");
        std::fs::write(&file, b"old").unwrap();
        atomic_write(&file, b"new contents").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"new contents");
        assert!(!dir.join("doc.pdf.preview-tmp").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
