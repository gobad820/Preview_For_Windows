import { describe, expect, test } from 'vitest';
import { en, ko } from '../../src/i18n/menus';

type Key = keyof typeof en;
const keys = Object.keys(en) as Key[];

describe('menu catalog', () => {
  test('uses the glossary terms', () => {
    // docs/superpowers/specs/2026-10-27-english-korean-ui-design.md, Glossary
    const glossary: Partial<Record<Key, string>> = {
      'menu.file': '파일',
      'menu.edit': '편집',
      'menu.view': '보기',
      'menu.go': '이동',
      'menu.tools': '도구',
      'menu.window': '윈도우',
      'menu.help': '도움말',
      'menu.app.about': 'Preview에 관하여',
      'menu.app.preferences': '설정…',
      'menu.help.shortcuts': '키보드 단축키',
      'menu.file.open': '열기…',
      'menu.file.save': '저장',
      'menu.file.saveAs': '다른 이름으로 저장…',
      'menu.file.print': '프린트…',
      'menu.file.close': '윈도우 닫기',
      'menu.file.insertPages': '파일에서 페이지 삽입…',
      'menu.edit.undo': '실행 취소',
      'menu.edit.redo': '실행 복귀',
      'menu.edit.cut': '오려두기',
      'menu.edit.copy': '복사하기',
      'menu.edit.paste': '붙여넣기',
      'menu.edit.delete': '삭제',
      'menu.edit.duplicate': '복제',
      'menu.edit.selectAll': '모든 페이지 선택',
      'menu.edit.find': '찾기…',
      'menu.view.showSidebar': '사이드바 보기',
      'menu.view.hideSidebar': '사이드바 가리기',
      'menu.view.thumbnails': '축소판',
      'menu.view.outline': '목차',
      'menu.view.continuous': '연속 스크롤',
      'menu.view.twoPages': '두 페이지',
      'menu.view.bookMode': '책 모드',
      'menu.view.actualSize': '실제 크기',
      'menu.view.fitWidth': '폭 맞춤',
      'menu.view.fitPage': '페이지 맞춤',
      'menu.view.zoomIn': '확대',
      'menu.view.zoomOut': '축소',
      'menu.view.rotateLeft': '왼쪽으로 회전',
      'menu.view.rotateRight': '오른쪽으로 회전',
      'menu.view.showMarkup': '마크업 도구 막대 보기',
      'menu.view.hideMarkup': '마크업 도구 막대 가리기',
      'menu.view.menuBar': '메뉴 막대',
      'menu.go.next': '다음 페이지',
      'menu.go.previous': '이전 페이지',
      'menu.go.first': '첫 페이지',
      'menu.go.last': '마지막 페이지',
      'menu.go.page': '페이지로 이동…',
      'menu.tools.select': '텍스트 선택',
      'menu.tools.highlight': '하이라이트',
      'menu.tools.underline': '밑줄',
      'menu.tools.strikeout': '취소선',
      'menu.tools.draw': '그리기',
      'menu.tools.line': '선',
      'menu.tools.arrow': '화살표',
      'menu.tools.rect': '사각형',
      'menu.tools.rounded': '둥근 사각형',
      'menu.tools.oval': '타원',
      'menu.tools.text': '텍스트',
      'menu.tools.note': '메모',
      'menu.window.minimize': '최소화',
      'menu.window.zoom': '확대/축소',
      'menu.shortcuts.close': '닫기',
    };
    for (const [k, v] of Object.entries(glossary)) expect(ko[k as Key], k).toBe(v);
  });

  test('commands that open a dialog keep the ellipsis in Korean', () => {
    for (const k of keys) {
      const [e, h] = [en[k], ko[k]];
      if (typeof e === 'string' && typeof h === 'string') expect(h.endsWith('…'), k).toBe(e.endsWith('…'));
    }
  });

  test('every Korean label is Korean, except the product name', () => {
    for (const k of keys) {
      const text = String(ko[k]);
      if (text === 'Preview') continue;
      expect(text, k).toMatch(/[가-힣]/);
    }
  });
});
