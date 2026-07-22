// Fixed-frame pan/zoom crop tool. The stage element defines the output aspect ratio;
// the user pans/zooms the image underneath it, and whatever is visible in the stage is the crop.
class CropTool {
  constructor(stageEl) {
    this.stage = stageEl;
    this.img = document.createElement("img");
    this.img.draggable = false;
    this.stage.innerHTML = "";
    this.stage.appendChild(this.img);

    this.scale = 1;
    this.minScale = 1;
    this.x = 0;
    this.y = 0;
    this.pointers = new Map();
    this.dragStart = null;
    this.pinchStartDist = null;
    this.pinchStartScale = null;

    this._bindEvents();
  }

  loadFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this.img.onload = () => {
        this._reset();
        resolve();
      };
      this.img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      this.img.src = url;
    });
  }

  _reset() {
    const stageW = this.stage.clientWidth;
    const stageH = this.stage.clientHeight;
    this.minScale = Math.max(stageW / this.img.naturalWidth, stageH / this.img.naturalHeight);
    this.scale = this.minScale;
    this.x = (stageW - this.img.naturalWidth * this.scale) / 2;
    this.y = (stageH - this.img.naturalHeight * this.scale) / 2;
    this._apply();
  }

  _clamp() {
    const stageW = this.stage.clientWidth;
    const stageH = this.stage.clientHeight;
    this.scale = Math.min(Math.max(this.scale, this.minScale), this.minScale * 4);
    const minX = stageW - this.img.naturalWidth * this.scale;
    const minY = stageH - this.img.naturalHeight * this.scale;
    this.x = Math.min(0, Math.max(minX, this.x));
    this.y = Math.min(0, Math.max(minY, this.y));
  }

  _apply() {
    this._clamp();
    this.img.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.img.style.transformOrigin = "0 0";
  }

  setScale(scale) {
    this.scale = scale;
    this._apply();
  }

  _bindEvents() {
    this.stage.addEventListener("pointerdown", (e) => {
      this.stage.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragStart = { x: e.clientX, y: e.clientY, ox: this.x, oy: this.y };
      } else if (this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.pinchStartScale = this.scale;
      }
    });

    this.stage.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.pinchStartDist) {
          this.scale = this.pinchStartScale * (dist / this.pinchStartDist);
          this._apply();
        }
      } else if (this.pointers.size === 1 && this.dragStart) {
        this.x = this.dragStart.ox + (e.clientX - this.dragStart.x);
        this.y = this.dragStart.oy + (e.clientY - this.dragStart.y);
        this._apply();
      }
    });

    const endPointer = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) {
        this.pinchStartDist = null;
      }
      if (this.pointers.size === 0) {
        this.dragStart = null;
      }
    };
    this.stage.addEventListener("pointerup", endPointer);
    this.stage.addEventListener("pointercancel", endPointer);

    this.stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = -e.deltaY * 0.0015;
        this.scale = this.scale * (1 + delta);
        this._apply();
      },
      { passive: false }
    );
  }

  toBlob(outputWidth, outputHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");

    const stageW = this.stage.clientWidth;
    const stageH = this.stage.clientHeight;
    const sourceX = -this.x / this.scale;
    const sourceY = -this.y / this.scale;
    const sourceW = stageW / this.scale;
    const sourceH = stageH / this.scale;

    ctx.drawImage(this.img, sourceX, sourceY, sourceW, sourceH, 0, 0, outputWidth, outputHeight);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  }
}
