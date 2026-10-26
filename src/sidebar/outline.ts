import type { OutlineNode } from '../pdf/document';

export interface OutlineDeps {
  goToPage(index: number, top?: number): void;
}

/**
 * Nested `<ul>` outline. Every node with children gets a disclosure toggle and starts collapsed;
 * clicking an item navigates to its destination without taking focus.
 */
export class OutlineTree {
  private nodes: OutlineNode[] = [];
  private readonly empty: HTMLElement;
  private readonly tree: HTMLUListElement;

  constructor(
    private readonly host: HTMLElement,
    private readonly deps: OutlineDeps,
  ) {
    this.tree = document.createElement('ul');
    this.tree.className = 'outline-tree';
    this.tree.setAttribute('role', 'tree');
    this.empty = document.createElement('p');
    this.empty.className = 'outline-empty';
    this.empty.textContent = 'No outline';
    host.append(this.tree, this.empty);
    host.addEventListener('click', this.onClick);
  }

  get isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  setOutline(nodes: OutlineNode[]): void {
    this.nodes = nodes;
    this.tree.replaceChildren(...nodes.map((n) => this.renderNode(n, 0)));
    this.tree.hidden = nodes.length === 0;
    this.empty.hidden = nodes.length > 0;
  }

  destroy(): void {
    this.host.removeEventListener('click', this.onClick);
    this.tree.remove();
    this.empty.remove();
  }

  // ---- internals ----------------------------------------------------------

  private renderNode(node: OutlineNode, depth: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'outline-node';
    li.setAttribute('role', 'treeitem');
    const row = document.createElement('div');
    row.className = 'outline-row';
    row.style.setProperty('--depth', String(depth));

    const title = node.title.replace(/\s+/g, ' ').trim() || '(untitled)';
    const hasChildren = node.children.length > 0;

    if (hasChildren) {
      li.classList.add('has-children', 'collapsed');
      li.setAttribute('aria-expanded', 'false');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'outline-toggle';
      toggle.tabIndex = -1;
      toggle.setAttribute('aria-label', `Expand ${title}`);
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'outline-spacer';
      row.append(spacer);
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'outline-item';
    item.tabIndex = -1;
    item.textContent = title;
    item.title = title;
    if (node.pageIndex != null) {
      item.dataset['page'] = String(node.pageIndex + 1);
      if (node.top != null) item.dataset['top'] = String(node.top);
    } else {
      item.disabled = true;
    }
    row.append(item);
    li.append(row);

    if (hasChildren) {
      const ul = document.createElement('ul');
      ul.className = 'outline-children';
      ul.setAttribute('role', 'group');
      ul.hidden = true;
      ul.append(...node.children.map((c) => this.renderNode(c, depth + 1)));
      li.append(ul);
    }
    return li;
  }

  private readonly onClick = (e: MouseEvent): void => {
    const target = e.target as Element | null;
    const toggle = target?.closest<HTMLButtonElement>('.outline-toggle');
    if (toggle) {
      this.toggle(toggle);
      return;
    }
    const item = target?.closest<HTMLButtonElement>('.outline-item');
    if (!item || item.disabled) return;
    const page = Number(item.dataset['page']);
    if (!(page > 0)) return;
    const top = item.dataset['top'];
    this.deps.goToPage(page - 1, top != null ? Number(top) : undefined);
  };

  private toggle(button: HTMLButtonElement): void {
    const li = button.closest<HTMLLIElement>('.outline-node');
    const children = li?.querySelector<HTMLUListElement>(':scope > .outline-children');
    if (!li || !children) return;
    const expand = children.hidden !== false;
    children.hidden = !expand;
    li.classList.toggle('expanded', expand);
    li.classList.toggle('collapsed', !expand);
    li.setAttribute('aria-expanded', String(expand));
    const title = li.querySelector<HTMLElement>(':scope > .outline-row > .outline-item')?.textContent ?? '';
    button.setAttribute('aria-label', `${expand ? 'Collapse' : 'Expand'} ${title}`);
  }
}
