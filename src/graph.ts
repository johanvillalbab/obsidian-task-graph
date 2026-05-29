import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from "d3-force";
import { colorForArea, TaskGraphSettings } from "./settings";
import { TaskModel, TaskNode } from "./taskModel";

interface SimNode extends TaskNode, SimulationNodeDatum {}
interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: "dependency" | "association";
  reason?: string;
}

export interface GraphCallbacks {
  onToggleStatus: (node: TaskNode) => void;
  onOpenNote: (node: TaskNode, newLeaf: boolean) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
  getSavedPosition: (id: string) => { x: number; y: number } | null;
}

const CARD_COLLIDE_RADIUS = 105;
const SVG_NS = "http://www.w3.org/2000/svg";

export class GraphRenderer {
  private viewport: HTMLElement;
  private world!: HTMLElement;
  private svg!: SVGSVGElement;
  private legend!: HTMLElement;
  private settings: TaskGraphSettings;
  private callbacks: GraphCallbacks;

  private sim: Simulation<SimNode, SimLink> | null = null;
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private cardEls = new Map<string, HTMLElement>();
  private edgeEls: { el: SVGLineElement; link: SimLink }[] = [];

  private scale = 1;
  private panX = 0;
  private panY = 0;

  // bound handlers kept for teardown
  private cleanups: Array<() => void> = [];

  constructor(
    viewport: HTMLElement,
    settings: TaskGraphSettings,
    callbacks: GraphCallbacks
  ) {
    this.viewport = viewport;
    this.settings = settings;
    this.callbacks = callbacks;
  }

  getCamera(): { panX: number; panY: number; scale: number } {
    return { panX: this.panX, panY: this.panY, scale: this.scale };
  }

  resetCamera(): void {
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
  }

  render(model: TaskModel, camera?: { panX: number; panY: number; scale: number }): void {
    this.destroy();
    this.viewport.empty();
    this.viewport.addClass("tg-viewport");

    this.world = this.viewport.createDiv({ cls: "tg-world" });
    this.svg = this.world.createSvg("svg", { cls: "tg-edges" }) as unknown as SVGSVGElement;
    this.buildArrowMarker();

    this.legend = this.viewport.createDiv({ cls: "tg-legend" });
    this.buildLegend(model);

    if (model.nodes.length === 0) {
      this.viewport.createDiv({ cls: "tg-empty", text: "No task notes found. Create one with /obsidian-task." });
      return;
    }

    const grid = this.settings.layout === "grid";

    // Group cluster centroids on a ring around the origin (force mode only).
    const centroids = this.computeCentroids(model);

    this.nodes = model.nodes.map((n) => {
      const saved = grid ? null : this.callbacks.getSavedPosition(n.id);
      const c = centroids.get(n.group) ?? { x: 0, y: 0 };
      const sn: SimNode = Object.assign({}, n) as SimNode;
      if (saved) {
        sn.x = saved.x;
        sn.y = saved.y;
        sn.fx = saved.x; // pinned: the user placed it deliberately
        sn.fy = saved.y;
      } else {
        sn.x = c.x + (Math.random() - 0.5) * 220;
        sn.y = c.y + (Math.random() - 0.5) * 220;
      }
      return sn;
    });

    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = model.edges
      .filter((e) => byId.has(e.source as string) && byId.has(e.target as string))
      .map((e) => ({ source: e.source, target: e.target, kind: e.kind, reason: e.reason }));

    this.buildCards();
    this.buildEdges();
    if (grid) {
      this.layoutGrid(model);
      this.onTick(); // paint once; no simulation runs in grid mode
    } else {
      this.startSimulation(centroids);
    }
    this.initPanZoom();
    if (camera) {
      this.panX = camera.panX;
      this.panY = camera.panY;
      this.scale = camera.scale;
      this.applyTransform();
    } else if (grid) {
      this.anchorTopInitially();
    } else {
      this.centerInitially();
    }
  }

  private computeCentroids(model: TaskModel): Map<string, { x: number; y: number }> {
    const centroids = new Map<string, { x: number; y: number }>();
    const n = Math.max(model.groups.length, 1);
    const radius = 240 + n * 40;
    model.groups.forEach((group, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      centroids.set(group, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    return centroids;
  }

  // Tidy grid: each group is a labeled section; its cards flow left-to-right in rows
  // of COLS columns, and groups stack downward. Cards are positioned deterministically,
  // so no force simulation runs in this mode.
  private layoutGrid(model: TaskModel): void {
    const COLS = 3;
    const CELL_W = 230; // column pitch; cards are 190px wide, so ~40px gutter
    const HEADER_H = 34;
    const ROW_GAP = 22; // gap below the tallest card in each row
    const GROUP_GAP = 44;
    const FALLBACK_H = 90;

    const colsTotalW = COLS * CELL_W;
    const leftCenterX = -colsTotalW / 2 + CELL_W / 2; // x-center of the first column
    const headerLeftX = -colsTotalW / 2 + 6;

    const byGroup = new Map<string, SimNode[]>();
    for (const n of this.nodes) {
      const arr = byGroup.get(n.group) ?? [];
      arr.push(n);
      byGroup.set(n.group, arr);
    }

    // Cards are already in the DOM, so measure each one's real height and advance
    // every row by the tallest card it contains. This keeps the gap between rows
    // consistent no matter how much text a card holds (no more overlap).
    let y = 0;
    for (const group of model.groups) {
      const members = byGroup.get(group) ?? [];
      if (members.length === 0) continue;

      const header = this.world.createDiv({ cls: "tg-group-header" });
      header.style.left = headerLeftX + "px";
      header.style.top = y + "px";
      header.style.width = colsTotalW - 12 + "px";
      const sw = header.createSpan({ cls: "tg-group-header-swatch" });
      sw.style.background = colorForArea(this.settings, group);
      header.createSpan({ cls: "tg-group-header-label", text: group });
      header.createSpan({ cls: "tg-group-header-count", text: String(members.length) });

      let rowTop = y + HEADER_H;
      for (let start = 0; start < members.length; start += COLS) {
        const row = members.slice(start, start + COLS);
        let rowH = 0;
        for (const node of row) {
          const el = this.cardEls.get(node.id);
          rowH = Math.max(rowH, el?.offsetHeight ?? FALLBACK_H);
        }
        row.forEach((node, col) => {
          node.fx = node.x = leftCenterX + col * CELL_W;
          node.fy = node.y = rowTop + rowH / 2;
        });
        rowTop += rowH + ROW_GAP;
      }
      y = rowTop - ROW_GAP + GROUP_GAP;
    }
  }

  private buildArrowMarker(): void {
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "tg-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    path.setAttribute("class", "tg-arrowhead");
    marker.appendChild(path);
    defs.appendChild(marker);
    this.svg.appendChild(defs);
  }

  private buildLegend(model: TaskModel): void {
    this.legend.empty();
    this.legend.createDiv({ cls: "tg-legend-title", text: "Groups" });
    for (const group of model.groups) {
      const row = this.legend.createDiv({ cls: "tg-legend-row" });
      const swatch = row.createSpan({ cls: "tg-legend-swatch" });
      swatch.style.background = colorForArea(this.settings, group);
      row.createSpan({ cls: "tg-legend-label", text: group });
    }
  }

  private buildCards(): void {
    for (const node of this.nodes) {
      const card = this.world.createDiv({ cls: "tg-card" });
      card.toggleClass("tg-done", node.done);
      card.toggleClass("tg-cancelled", node.status === "cancelled");
      card.toggleClass("tg-waiting", node.status === "waiting" || node.status === "blocked");
      card.style.setProperty("--tg-area-color", colorForArea(this.settings, node.group));

      const head = card.createDiv({ cls: "tg-card-head" });
      const toggle = head.createDiv({ cls: "tg-toggle" });
      toggle.setAttribute("aria-label", "Toggle done");
      toggle.toggleClass("tg-toggle-on", node.done);
      toggle.addEventListener("pointerdown", (e) => e.stopPropagation());
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onToggleStatus(node);
      });

      const title = head.createDiv({ cls: "tg-title", text: node.title });
      title.addEventListener("pointerdown", (e) => e.stopPropagation());
      title.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onOpenNote(node, e.metaKey || e.ctrlKey);
      });

      const meta = card.createDiv({ cls: "tg-card-meta" });
      if (node.priority) meta.createSpan({ cls: "tg-priority", text: node.priority });
      meta.createSpan({ cls: "tg-group", text: node.group });
      if (node.due) meta.createSpan({ cls: "tg-due", text: "due " + node.due });

      this.attachDrag(card, node);
      this.cardEls.set(node.id, card);
    }
  }

  private buildEdges(): void {
    this.edgeEls = [];
    for (const link of this.links) {
      const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
      line.setAttribute("class", link.kind === "dependency" ? "tg-edge tg-edge-dep" : "tg-edge tg-edge-assoc");
      if (link.kind === "dependency") line.setAttribute("marker-end", "url(#tg-arrow)");
      if (link.reason) line.appendChild(this.titleNode(link.reason));
      this.svg.appendChild(line);
      this.edgeEls.push({ el: line, link });
    }
  }

  private titleNode(text: string): SVGTitleElement {
    const t = document.createElementNS(SVG_NS, "title") as SVGTitleElement;
    t.textContent = text;
    return t;
  }

  private startSimulation(centroids: Map<string, { x: number; y: number }>): void {
    const cx = (d: SimNode) => (centroids.get(d.group)?.x ?? 0);
    const cy = (d: SimNode) => (centroids.get(d.group)?.y ?? 0);

    this.sim = forceSimulation<SimNode, SimLink>(this.nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(this.links)
          .id((d) => (d as SimNode).id)
          .distance(this.settings.linkDistance)
          .strength((l) => (l.kind === "dependency" ? 0.45 : 0.06))
      )
      .force("charge", forceManyBody().strength(this.settings.chargeStrength))
      .force("collide", forceCollide<SimNode>(CARD_COLLIDE_RADIUS))
      .force("x", forceX<SimNode>(cx).strength(this.settings.clusterStrength))
      .force("y", forceY<SimNode>(cy).strength(this.settings.clusterStrength))
      .force("center", forceCenter(0, 0).strength(0.02))
      .on("tick", () => this.onTick());
  }

  private onTick(): void {
    for (const node of this.nodes) {
      const card = this.cardEls.get(node.id);
      if (!card) continue;
      card.style.left = (node.x ?? 0) + "px";
      card.style.top = (node.y ?? 0) + "px";
    }
    for (const { el, link } of this.edgeEls) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      el.setAttribute("x1", String(s.x ?? 0));
      el.setAttribute("y1", String(s.y ?? 0));
      el.setAttribute("x2", String(t.x ?? 0));
      el.setAttribute("y2", String(t.y ?? 0));
    }
  }

  // ---- interaction ---------------------------------------------------------

  private attachDrag(card: HTMLElement, node: SimNode): void {
    let startClientX = 0;
    let startClientY = 0;
    let startNodeX = 0;
    let startNodeY = 0;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (this.settings.layout === "grid") return; // grid positions are fixed
      dragging = true;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startNodeX = node.x ?? 0;
      startNodeY = node.y ?? 0;
      node.fx = startNodeX;
      node.fy = startNodeY;
      card.addClass("tg-dragging");
      this.sim?.alphaTarget(0.3).restart();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = (e.clientX - startClientX) / this.scale;
      const dy = (e.clientY - startClientY) / this.scale;
      node.fx = startNodeX + dx;
      node.fy = startNodeY + dy;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      card.removeClass("tg-dragging");
      this.sim?.alphaTarget(0);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Keep the node pinned where it was dropped, and persist that position.
      if (node.fx != null && node.fy != null) {
        this.callbacks.onPositionChange(node.id, node.fx, node.fy);
      }
    };

    card.addEventListener("pointerdown", onDown);
    this.cleanups.push(() => {
      card.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    });
  }

  private initPanZoom(): void {
    let panning = false;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;

    const onDown = (e: PointerEvent) => {
      // Only pan when the background (not a card) is grabbed.
      if (e.target !== this.viewport && e.target !== this.world && e.target !== this.svg) return;
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      startPanX = this.panX;
      startPanY = this.panY;
      this.viewport.addClass("tg-panning");
    };
    const onMove = (e: PointerEvent) => {
      if (!panning) return;
      this.panX = startPanX + (e.clientX - startX);
      this.panY = startPanY + (e.clientY - startY);
      this.applyTransform();
    };
    const onUp = () => {
      panning = false;
      this.viewport.removeClass("tg-panning");
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Proportional zoom: the factor scales with the gesture magnitude, so a gentle
      // trackpad swipe nudges slightly while a big scroll zooms a bit more. The small
      // sensitivity keeps it smooth instead of jumping a fixed 10% per wheel event.
      // Normalize line/page delta modes to pixels, then clamp to cap any single event.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      const dy = Math.max(-50, Math.min(50, e.deltaY * unit));
      const factor = Math.exp(-dy * 0.005);
      const newScale = Math.min(2.5, Math.max(0.2, this.scale * factor));
      // Zoom around the cursor: keep the world point under the cursor fixed.
      this.panX = mx - (mx - this.panX) * (newScale / this.scale);
      this.panY = my - (my - this.panY) * (newScale / this.scale);
      this.scale = newScale;
      this.applyTransform();
    };

    this.viewport.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    this.viewport.addEventListener("wheel", onWheel, { passive: false });

    this.cleanups.push(() => {
      this.viewport.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.viewport.removeEventListener("wheel", onWheel);
    });
  }

  private centerInitially(): void {
    const rect = this.viewport.getBoundingClientRect();
    this.panX = rect.width / 2;
    this.panY = rect.height / 2;
    this.applyTransform();
  }

  // Grid content grows downward from the origin, so center it horizontally but anchor
  // its top near the top of the viewport instead of centering vertically.
  private anchorTopInitially(): void {
    const rect = this.viewport.getBoundingClientRect();
    this.panX = rect.width / 2;
    this.panY = 56;
    this.scale = 1;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
  }

  destroy(): void {
    this.sim?.stop();
    this.sim = null;
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.cardEls.clear();
    this.edgeEls = [];
    this.nodes = [];
    this.links = [];
  }
}
