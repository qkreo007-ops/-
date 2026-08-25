/**
 * TutorMark Canvas Annotation Studio
 * High-performance, zoomable, multi-tool annotation engine for tutoring & mentoring.
 */
const HISTORY_LIMIT = 120;

class TutorMarkCanvasEditor {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Container #${containerId} not found`);
      return;
    }

    // Canvas elements
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.className = 'absolute inset-0';
    this.container.appendChild(this.canvas);

    // Image & viewport state
    this.bgImage = null;
    this.imageLoaded = false;
    this.imgWidth = 0;
    this.imgHeight = 0;
    this.loadToken = 0; // guards against out-of-order image loads

    // Viewport transform (zoom & pan)
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.minScale = 0.2;
    this.maxScale = 5.0;

    // Viewport size in CSS pixels (set by resizeCanvas once the modal is visible)
    this.viewWidth = 0;
    this.viewHeight = 0;

    // Tool state
    this.currentTool = 'pen'; // 'pen', 'highlighter', 'text', 'line', 'arrow', 'rect', 'circle', 'grade-o', 'grade-x', 'grade-check', 'eraser', 'pan'
    this.currentColor = '#ef4444'; // Red default
    this.currentWidth = 4;
    this.currentFontSize = 20;

    // Drawing data & history (snapshot based: covers draw, erase and clear alike)
    this.objects = [];
    this.history = [[]];
    this.historyIndex = 0;

    // Interaction flags
    this.isDrawing = false;
    this.isPanning = false;
    this.erasedDuringStroke = false;
    this.activePointerId = null;
    this.startPanX = 0;
    this.startPanY = 0;
    this.currentPoints = [];
    this.shapeStart = null;
    this.shapeCurrent = null;
    this.spacePressed = false;

    // Multi-touch pinch state (tablet / touchscreen support)
    this.activePointers = new Map();
    this.pinchStartDist = 0;
    this.pinchStartScale = 1;

    // Text input element
    this.activeTextInput = null;

    // Render scheduling (coalesce repaints into one per animation frame)
    this.renderQueued = false;

    // Notified when the drawing changes, so the host page can warn about unsaved work
    this.onDirtyChange = null;

    this.initEventListeners();
    this.resizeCanvas();
  }

  /** The editor only reacts to global keys while its modal is actually on screen. */
  isActive() {
    const modal = this.container.closest('.hidden');
    return !modal && this.container.offsetParent !== null;
  }

  resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Match the backing store to the device pixel ratio so strokes stay crisp on HiDPI screens
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Work in CSS pixels everywhere else
    this.viewWidth = rect.width;
    this.viewHeight = rect.height;
    this.render();
  }

  loadImage(imageUrl, initialData = null) {
    const token = ++this.loadToken;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        if (token !== this.loadToken) return; // a newer load already won
        this.bgImage = img;
        this.imgWidth = img.naturalWidth;
        this.imgHeight = img.naturalHeight;
        this.imageLoaded = true;

        this.setObjects(this.parseVectorData(initialData));
        this.fitToScreen();
        resolve();
      };

      img.onerror = () => {
        if (token !== this.loadToken) return;
        this.imageLoaded = false;
        this.bgImage = null;
        this.render();
        reject(new Error('이미지를 불러오지 못했습니다. (주소가 잘못되었거나 CORS 설정이 필요합니다)'));
      };

      img.src = imageUrl;
    });
  }

  /** Accepts an array, a JSON string, or null and always returns a usable object array. */
  parseVectorData(data) {
    if (!data) return [];
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('Failed to parse annotation data:', e);
      return [];
    }
  }

  // --- Vector data interchange (used for per-page caching by app.js) ---
  exportVectorData() {
    return this.objects.map(obj => ({ ...obj }));
  }

  importVectorData(data) {
    this.setObjects(this.parseVectorData(data));
    this.render();
  }

  /** Replaces the drawing wholesale and restarts the history at that state. */
  setObjects(objects) {
    this.objects = Array.isArray(objects) ? objects.map(o => ({ ...o })) : [];
    this.history = [this.objects.map(o => ({ ...o }))];
    this.historyIndex = 0;
    this.notifyDirtyChange();
  }

  /** Removes annotations but keeps the loaded background image and viewport. */
  clearDrawingsOnly() {
    this.setObjects([]);
    this.render();
  }

  hasAnnotations() {
    return this.objects.length > 0;
  }

  fitToScreen() {
    if (!this.imageLoaded) return;
    const cw = this.viewWidth;
    const ch = this.viewHeight;

    const scaleX = (cw * 0.92) / this.imgWidth;
    const scaleY = (ch * 0.92) / this.imgHeight;
    this.scale = Math.min(scaleX, scaleY, 1.2);

    this.panX = (cw - this.imgWidth * this.scale) / 2;
    this.panY = (ch - this.imgHeight * this.scale) / 2;

    this.render();
    this.notifyZoomChanged();
  }

  resetZoom() {
    if (!this.imageLoaded) return;
    this.scale = 1.0;
    this.panX = (this.viewWidth - this.imgWidth * this.scale) / 2;
    this.panY = (this.viewHeight - this.imgHeight * this.scale) / 2;
    this.render();
    this.notifyZoomChanged();
  }

  setZoom(newScale, centerX = this.viewWidth / 2, centerY = this.viewHeight / 2) {
    const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
    if (clampedScale === this.scale) return;

    // Zoom centered around (centerX, centerY)
    const factor = clampedScale / this.scale;
    this.panX = centerX - (centerX - this.panX) * factor;
    this.panY = centerY - (centerY - this.panY) * factor;
    this.scale = clampedScale;

    this.render();
    this.notifyZoomChanged();
  }

  zoomIn() {
    this.setZoom(this.scale * 1.25);
  }

  zoomOut() {
    this.setZoom(this.scale / 1.25);
  }

  setTool(tool) {
    this.commitTextInput();
    this.currentTool = tool;
    this.updateCursor();
  }

  setColor(color) {
    this.currentColor = color;
    if (this.activeTextInput) this.activeTextInput.style.color = color;
  }

  setLineWidth(width) {
    this.currentWidth = width;
  }

  setFontSize(size) {
    this.currentFontSize = size;
    if (this.activeTextInput) {
      this.activeTextInput.style.fontSize = `${Math.max(14, size * this.scale)}px`;
    }
  }

  updateCursor() {
    this.container.classList.remove('cursor-pan', 'cursor-text', 'cursor-eraser', 'cursor-draw');
    if (this.currentTool === 'pan' || this.spacePressed) {
      this.container.classList.add('cursor-pan');
    } else if (this.currentTool === 'text') {
      this.container.classList.add('cursor-text');
    } else if (this.currentTool === 'eraser') {
      this.container.classList.add('cursor-eraser');
    } else {
      this.container.classList.add('cursor-draw');
    }
  }

  // Coordinate transformation: Screen -> Image coordinates
  screenToImage(screenX, screenY) {
    return {
      x: (screenX - this.panX) / this.scale,
      y: (screenY - this.panY) / this.scale
    };
  }

  // Coordinate transformation: Image -> Screen coordinates
  imageToScreen(imgX, imgY) {
    return {
      x: imgX * this.scale + this.panX,
      y: imgY * this.scale + this.panY
    };
  }

  initEventListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());

    // Mouse Wheel Zoom
    this.container.addEventListener('wheel', (e) => {
      if (!this.imageLoaded) return;
      e.preventDefault();
      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.setZoom(this.scale * zoomFactor, mouseX, mouseY);
    }, { passive: false });

    // Right-drag pans, so suppress the context menu inside the canvas only
    this.container.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard shortcuts (Spacebar for pan, Ctrl+Z for undo, Ctrl+Y for redo)
    window.addEventListener('keydown', (e) => {
      if (!this.isActive()) return;
      if (this.isTypingTarget(document.activeElement)) return;

      if (e.code === 'Space' && !this.spacePressed) {
        this.spacePressed = true;
        this.updateCursor();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.spacePressed) {
        this.spacePressed = false;
        this.updateCursor();
      }
    });

    // Pointer events (handles Mouse, Pen stylus, and Touch)
    this.container.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    this.container.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    this.container.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.container.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
  }

  /** True for anything the user could be typing into, contentEditable included. */
  isTypingTarget(el) {
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
  }

  getPointerPos(e) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  handlePointerDown(e) {
    if (!this.imageLoaded) return;

    // Track every active pointer so two fingers can pinch-zoom
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.activePointers.size === 2) {
      this.cancelActiveStroke();
      const pts = [...this.activePointers.values()];
      this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchStartScale = this.scale;
      return;
    }
    if (this.activePointers.size > 2) return;

    const pos = this.getPointerPos(e);

    // Pan with Middle Click, Right Click, or Hand Tool or Space+Click
    if (e.button === 1 || e.button === 2 || this.currentTool === 'pan' || this.spacePressed) {
      this.isPanning = true;
      this.activePointerId = e.pointerId;
      this.startPanX = pos.x - this.panX;
      this.startPanY = pos.y - this.panY;
      this.capturePointer(e);
      return;
    }

    if (e.button !== 0) return; // Only primary button for drawing

    const imgCoord = this.screenToImage(pos.x, pos.y);

    if (this.currentTool === 'text') {
      e.preventDefault();
      this.showInlineTextInput(pos.x, pos.y, imgCoord.x, imgCoord.y);
      return;
    }

    this.activePointerId = e.pointerId;
    this.capturePointer(e);

    if (this.currentTool === 'eraser') {
      this.isDrawing = true;
      this.erasedDuringStroke = false;
      this.eraseAt(imgCoord.x, imgCoord.y);
      return;
    }

    // Quick Grading Stamps (O, X, Check, etc.)
    if (this.currentTool.startsWith('grade-')) {
      this.addObject({
        id: this.nextId(),
        type: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth,
        x: imgCoord.x,
        y: imgCoord.y,
        size: Math.max(32, this.currentFontSize * 2)
      });
      return;
    }

    // Pen, Highlighter, Shapes
    this.isDrawing = true;
    this.currentPoints = [{ x: imgCoord.x, y: imgCoord.y }];

    if (['line', 'arrow', 'rect', 'circle'].includes(this.currentTool)) {
      this.shapeStart = { x: imgCoord.x, y: imgCoord.y };
      this.shapeCurrent = { x: imgCoord.x, y: imgCoord.y };
    }
  }

  handlePointerMove(e) {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger pinch zoom
    if (this.activePointers.size === 2) {
      const pts = [...this.activePointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchStartDist > 0) {
        const rect = this.container.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
        this.setZoom(this.pinchStartScale * (dist / this.pinchStartDist), midX, midY);
      }
      return;
    }

    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    const pos = this.getPointerPos(e);

    if (this.isPanning) {
      this.panX = pos.x - this.startPanX;
      this.panY = pos.y - this.startPanY;
      this.render();
      return;
    }

    if (!this.isDrawing) return;

    const imgCoord = this.screenToImage(pos.x, pos.y);

    if (this.currentTool === 'eraser') {
      this.eraseAt(imgCoord.x, imgCoord.y);
      return;
    }

    if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
      this.currentPoints.push({ x: imgCoord.x, y: imgCoord.y });
      this.render();
    } else if (['line', 'arrow', 'rect', 'circle'].includes(this.currentTool)) {
      this.shapeCurrent = { x: imgCoord.x, y: imgCoord.y };
      this.render();
    }
  }

  handlePointerUp(e) {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) this.pinchStartDist = 0;

    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    this.releasePointer(e);
    this.activePointerId = null;

    if (this.isPanning) {
      this.isPanning = false;
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentTool === 'eraser') {
      // One undo step per eraser drag, not per erased stroke
      if (this.erasedDuringStroke) {
        this.pushHistory();
        this.erasedDuringStroke = false;
      }
      return;
    }

    if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
      if (this.currentPoints.length > 0) {
        this.addObject({
          id: this.nextId(),
          type: this.currentTool,
          color: this.currentColor,
          width: this.currentTool === 'highlighter' ? Math.max(14, this.currentWidth * 3.5) : this.currentWidth,
          opacity: this.currentTool === 'highlighter' ? 0.38 : 1.0,
          points: [...this.currentPoints]
        });
      }
      this.currentPoints = [];
    } else if (['line', 'arrow', 'rect', 'circle'].includes(this.currentTool)) {
      // Ignore accidental zero-size shapes from a stray click
      if (this.shapeStart && this.shapeCurrent &&
          (Math.abs(this.shapeCurrent.x - this.shapeStart.x) > 2 ||
           Math.abs(this.shapeCurrent.y - this.shapeStart.y) > 2)) {
        this.addObject({
          id: this.nextId(),
          type: this.currentTool,
          color: this.currentColor,
          width: this.currentWidth,
          startX: this.shapeStart.x,
          startY: this.shapeStart.y,
          endX: this.shapeCurrent.x,
          endY: this.shapeCurrent.y
        });
      }
      this.shapeStart = null;
      this.shapeCurrent = null;
    }

    this.render();
  }

  /** Drops an in-progress stroke without committing it (used when a pinch starts). */
  cancelActiveStroke() {
    this.isDrawing = false;
    this.isPanning = false;
    this.currentPoints = [];
    this.shapeStart = null;
    this.shapeCurrent = null;
    this.erasedDuringStroke = false;
    this.render();
  }

  capturePointer(e) {
    // Keeps receiving events when the pointer leaves the canvas mid-stroke
    try {
      this.container.setPointerCapture(e.pointerId);
    } catch (err) { /* not supported for this pointer */ }
  }

  releasePointer(e) {
    try {
      if (this.container.hasPointerCapture && this.container.hasPointerCapture(e.pointerId)) {
        this.container.releasePointerCapture(e.pointerId);
      }
    } catch (err) { /* already released */ }
  }

  nextId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  showInlineTextInput(screenX, screenY, imgX, imgY) {
    if (this.activeTextInput) {
      this.commitTextInput();
    }

    const input = document.createElement('div');
    input.className = 'canvas-text-overlay';
    input.contentEditable = 'true';
    input.dataset.placeholder = '텍스트 입력 후 Enter (줄바꿈: Shift+Enter)';
    input.style.left = `${screenX}px`;
    input.style.top = `${screenY}px`;
    input.style.color = this.currentColor;
    input.style.fontSize = `${Math.max(14, this.currentFontSize * this.scale)}px`;

    this.container.appendChild(input);

    let settled = false;

    const commit = () => {
      if (settled) return;
      settled = true;

      const text = input.innerText.replace(/\u00a0/g, ' ').replace(/\n+$/, '');
      if (text.trim()) {
        this.addObject({
          id: this.nextId(),
          type: 'text',
          text: text,
          color: this.currentColor,
          fontSize: this.currentFontSize,
          x: imgX,
          y: imgY
        });
      }
      input.remove();
      this.activeTextInput = null;
      this.render();
    };

    const cancel = () => {
      if (settled) return;
      settled = true;
      input.remove();
      this.activeTextInput = null;
      this.render();
    };

    input.addEventListener('keydown', (e) => {
      // Keep every keystroke inside the box; the canvas shortcuts must not fire here
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    // Focus after the current event finishes, otherwise the browser's own
    // mousedown handling blurs the box the moment it appears
    requestAnimationFrame(() => {
      if (settled) return;
      input.focus();
      input.addEventListener('blur', commit);
    });

    this.activeTextInput = input;
  }

  commitTextInput() {
    if (this.activeTextInput) {
      this.activeTextInput.blur();
    }
  }

  eraseAt(imgX, imgY) {
    const eraseRadius = 25 / this.scale;
    const prevCount = this.objects.length;

    this.objects = this.objects.filter(obj => {
      const type = obj.type || '';

      if (type === 'text') {
        return Math.hypot(obj.x - imgX, obj.y - imgY) > eraseRadius + 15;
      }

      if (Array.isArray(obj.points)) {
        for (const pt of obj.points) {
          if (Math.hypot(pt.x - imgX, pt.y - imgY) < eraseRadius) return false;
        }
        return true;
      }

      if (obj.startX !== undefined) {
        return this.distanceToSegment(imgX, imgY, obj.startX, obj.startY, obj.endX, obj.endY) > eraseRadius;
      }

      if (type.startsWith('grade-')) {
        return Math.hypot(obj.x - imgX, obj.y - imgY) > eraseRadius + 15;
      }

      return true;
    });

    if (this.objects.length !== prevCount) {
      this.erasedDuringStroke = true;
      this.notifyDirtyChange();
      this.render();
    }
  }

  /** Shortest distance from a point to a line segment — lets the eraser hit anywhere on a shape. */
  distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  addObject(obj) {
    this.objects.push(obj);
    this.pushHistory();
    this.render();
  }

  // --- Snapshot history ---
  pushHistory() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.objects.map(o => ({ ...o })));

    if (this.history.length > HISTORY_LIMIT) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
    this.notifyDirtyChange();
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.objects = this.history[this.historyIndex].map(o => ({ ...o }));
    this.notifyDirtyChange();
    this.render();
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.objects = this.history[this.historyIndex].map(o => ({ ...o }));
    this.notifyDirtyChange();
    this.render();
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  /** Wipes the drawing but leaves it on the undo stack, so Ctrl+Z brings it back. */
  clearAll() {
    if (this.objects.length === 0) return;
    this.objects = [];
    this.pushHistory();
    this.render();
  }

  notifyDirtyChange() {
    if (this.onDirtyChange) this.onDirtyChange(this.objects.length > 0);
  }

  // --- Rendering Loop ---
  /** Coalesces repaint requests so a fast drag repaints once per frame, not once per event. */
  render() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.draw();
    });
  }

  draw() {
    if (!this.canvas) return;
    const ctx = this.ctx;
    const cw = this.viewWidth;
    const ch = this.viewHeight;

    ctx.clearRect(0, 0, cw, ch);

    if (!this.imageLoaded || !this.bgImage) {
      ctx.save();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px Pretendard, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('이미지를 불러오는 중이거나 선택된 이미지가 없습니다.', cw / 2, ch / 2);
      ctx.restore();
      return;
    }

    ctx.save();

    // Apply Viewport Transform
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // Draw Background Image
    ctx.drawImage(this.bgImage, 0, 0, this.imgWidth, this.imgHeight);

    // Draw Objects
    for (const obj of this.objects) {
      this.drawObject(ctx, obj, 1.0);
    }

    // Draw in-progress Stroke
    if (this.isDrawing && (this.currentTool === 'pen' || this.currentTool === 'highlighter') && this.currentPoints.length > 0) {
      this.drawObject(ctx, {
        type: this.currentTool,
        color: this.currentColor,
        width: this.currentTool === 'highlighter' ? Math.max(14, this.currentWidth * 3.5) : this.currentWidth,
        opacity: this.currentTool === 'highlighter' ? 0.38 : 1.0,
        points: this.currentPoints
      }, 1.0);
    }

    // Draw in-progress Shape
    if (this.isDrawing && ['line', 'arrow', 'rect', 'circle'].includes(this.currentTool) && this.shapeStart && this.shapeCurrent) {
      this.drawObject(ctx, {
        type: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth,
        startX: this.shapeStart.x,
        startY: this.shapeStart.y,
        endX: this.shapeCurrent.x,
        endY: this.shapeCurrent.y
      }, 1.0);
    }

    ctx.restore();
  }

  drawObject(ctx, obj, scaleFactor = 1.0) {
    if (!obj || !obj.type) return;

    ctx.save();
    try {
      this.paintObject(ctx, obj, scaleFactor);
    } finally {
      // Always unwind the save, even when an object turns out to be malformed
      ctx.restore();
    }
  }

  paintObject(ctx, obj, scaleFactor) {
    if (obj.type === 'pen' || obj.type === 'highlighter') {
      if (!obj.points || obj.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = obj.opacity || 1.0;

      if (obj.points.length === 1) {
        ctx.arc(obj.points[0].x, obj.points[0].y, (obj.width * scaleFactor) / 2, 0, Math.PI * 2);
        ctx.fillStyle = obj.color;
        ctx.fill();
      } else {
        ctx.moveTo(obj.points[0].x, obj.points[0].y);
        for (let i = 1; i < obj.points.length - 1; i++) {
          const xc = (obj.points[i].x + obj.points[i + 1].x) / 2;
          const yc = (obj.points[i].y + obj.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(obj.points[i].x, obj.points[i].y, xc, yc);
        }
        ctx.lineTo(obj.points[obj.points.length - 1].x, obj.points[obj.points.length - 1].y);
        ctx.stroke();
      }
    } else if (obj.type === 'line') {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width * scaleFactor;
      ctx.lineCap = 'round';
      ctx.moveTo(obj.startX, obj.startY);
      ctx.lineTo(obj.endX, obj.endY);
      ctx.stroke();
    } else if (obj.type === 'arrow') {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width * scaleFactor;
      ctx.fillStyle = obj.color;
      ctx.lineCap = 'round';

      // Scale the head with the stroke so thick arrows do not look pin-headed
      const headlen = Math.max(16, obj.width * 4) * scaleFactor;
      const dx = obj.endX - obj.startX;
      const dy = obj.endY - obj.startY;
      const angle = Math.atan2(dy, dx);

      ctx.moveTo(obj.startX, obj.startY);
      ctx.lineTo(obj.endX, obj.endY);
      ctx.stroke();

      // Arrow head
      ctx.beginPath();
      ctx.moveTo(obj.endX, obj.endY);
      ctx.lineTo(obj.endX - headlen * Math.cos(angle - Math.PI / 6), obj.endY - headlen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(obj.endX - headlen * Math.cos(angle + Math.PI / 6), obj.endY - headlen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (obj.type === 'rect') {
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width * scaleFactor;
      ctx.lineJoin = 'round';
      ctx.strokeRect(obj.startX, obj.startY, obj.endX - obj.startX, obj.endY - obj.startY);
    } else if (obj.type === 'circle') {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width * scaleFactor;
      const radiusX = Math.abs(obj.endX - obj.startX) / 2;
      const radiusY = Math.abs(obj.endY - obj.startY) / 2;
      const centerX = Math.min(obj.startX, obj.endX) + radiusX;
      const centerY = Math.min(obj.startY, obj.endY) + radiusY;
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (obj.type === 'text') {
      ctx.font = `600 ${obj.fontSize * scaleFactor}px Pretendard, sans-serif`;
      ctx.textBaseline = 'top';

      const lines = String(obj.text || '').split('\n');
      const lineHeight = obj.fontSize * 1.3 * scaleFactor;

      // Draw background pill for maximum contrast and readability
      let maxLineWidth = 0;
      lines.forEach(l => {
        const m = ctx.measureText(l).width;
        if (m > maxLineWidth) maxLineWidth = m;
      });

      const padX = 8 * scaleFactor;
      const padY = 4 * scaleFactor;
      const totalH = lines.length * lineHeight;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = 1.5 * scaleFactor;

      const rx = obj.x - padX;
      const ry = obj.y - padY;
      const rw = maxLineWidth + padX * 2;
      const rh = totalH + padY * 2;
      const r = 6 * scaleFactor;

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(rx, ry, rw, rh, r);
      } else {
        // Safari < 16 and other older engines have no roundRect
        ctx.rect(rx, ry, rw, rh);
      }
      ctx.fill();
      ctx.stroke();

      // Text
      ctx.fillStyle = obj.color;
      lines.forEach((line, idx) => {
        ctx.fillText(line, obj.x, obj.y + idx * lineHeight);
      });
    } else if (obj.type === 'grade-o') {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = (obj.width + 2) * scaleFactor;
      ctx.arc(obj.x, obj.y, (obj.size / 2) * scaleFactor, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj.type === 'grade-x') {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = (obj.width + 2) * scaleFactor;
      ctx.lineCap = 'round';
      const r = (obj.size / 2) * scaleFactor;
      ctx.moveTo(obj.x - r, obj.y - r);
      ctx.lineTo(obj.x + r, obj.y + r);
      ctx.moveTo(obj.x + r, obj.y - r);
      ctx.lineTo(obj.x - r, obj.y + r);
      ctx.stroke();
    } else if (obj.type === 'grade-check') {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = (obj.width + 2) * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const r = (obj.size / 2) * scaleFactor;
      ctx.moveTo(obj.x - r, obj.y);
      ctx.lineTo(obj.x - r * 0.2, obj.y + r * 0.8);
      ctx.lineTo(obj.x + r, obj.y - r * 0.8);
      ctx.stroke();
    }
  }

  // --- High-Resolution Synthesis & Export ---
  exportAnnotatedImage() {
    if (!this.imageLoaded || !this.bgImage) return null;

    // Make sure a half-typed annotation still makes it into the export
    this.commitTextInput();

    // Create offscreen canvas with original image's native resolution
    const offscreen = document.createElement('canvas');
    offscreen.width = this.imgWidth;
    offscreen.height = this.imgHeight;
    const offCtx = offscreen.getContext('2d');

    // 1. Draw original base image
    offCtx.drawImage(this.bgImage, 0, 0, this.imgWidth, this.imgHeight);

    // 2. Render all annotations at full 1:1 scale
    for (const obj of this.objects) {
      this.drawObject(offCtx, obj, 1.0);
    }

    let dataUrl;
    try {
      dataUrl = offscreen.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      // A cross-origin image without CORS headers taints the canvas
      throw new Error('첨삭본을 저장할 수 없습니다. 이미지 서버의 CORS 설정을 확인해주세요.');
    }

    return {
      dataUrl: dataUrl,
      vectorData: JSON.stringify(this.objects),
      objects: this.exportVectorData(),
      width: this.imgWidth,
      height: this.imgHeight
    };
  }

  notifyZoomChanged() {
    if (this.onZoomChange) {
      this.onZoomChange(Math.round(this.scale * 100));
    }
  }
}

window.TutorMarkCanvasEditor = TutorMarkCanvasEditor;
