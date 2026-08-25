/**
 * TutorMark Canvas Annotation Studio
 * High-performance, zoomable, multi-tool annotation engine for tutoring & mentoring.
 */
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

    // Viewport transform (zoom & pan)
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.minScale = 0.2;
    this.maxScale = 5.0;

    // Tool state
    this.currentTool = 'pen'; // 'pen', 'highlighter', 'text', 'line', 'arrow', 'rect', 'circle', 'grade-o', 'grade-x', 'grade-check', 'eraser', 'pan'
    this.currentColor = '#ef4444'; // Red default
    this.currentWidth = 4;
    this.currentFontSize = 20;

    // Drawing data & history
    this.objects = []; // Array of drawn elements { type, color, width, points, text, ... }
    this.undoStack = [];
    this.redoStack = [];

    // Interaction flags
    this.isDrawing = false;
    this.isPanning = false;
    this.startPanX = 0;
    this.startPanY = 0;
    this.currentPoints = [];
    this.spacePressed = false;

    // Text input element
    this.activeTextInput = null;

    // Initialize
    this.initEventListeners();
    this.resizeCanvas();
  }

  resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    // Set actual canvas resolution matching CSS size
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.render();
  }

  loadImage(imageUrl, initialData = null) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.bgImage = img;
        this.imgWidth = img.naturalWidth;
        this.imgHeight = img.naturalHeight;
        this.imageLoaded = true;

        // Reset history
        this.objects = [];
        this.undoStack = [];
        this.redoStack = [];

        // Load existing annotation data if provided
        if (initialData) {
          try {
            const parsed = typeof initialData === 'string' ? JSON.parse(initialData) : initialData;
            if (Array.isArray(parsed)) {
              this.objects = parsed;
            }
          } catch (e) {
            console.warn('Failed to parse initial annotation data:', e);
          }
        }

        // Fit image nicely into container
        this.fitToScreen();
        resolve();
      };
      img.onerror = (err) => {
        console.error('Failed to load image:', imageUrl, err);
        reject(err);
      };
      img.src = imageUrl;
    });
  }

  fitToScreen() {
    if (!this.imageLoaded) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const scaleX = (cw * 0.92) / this.imgWidth;
    const scaleY = (ch * 0.92) / this.imgHeight;
    this.scale = Math.min(scaleX, scaleY, 1.2);

    this.panX = (cw - this.imgWidth * this.scale) / 2;
    this.panY = (ch - this.imgHeight * this.scale) / 2;

    this.render();
    this.notifyZoomChanged();
  }

  resetZoom() {
    this.scale = 1.0;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.panX = (cw - this.imgWidth * this.scale) / 2;
    this.panY = (ch - this.imgHeight * this.scale) / 2;
    this.render();
    this.notifyZoomChanged();
  }

  setZoom(newScale, centerX = this.canvas.width / 2, centerY = this.canvas.height / 2) {
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
    this.currentTool = tool;
    this.updateCursor();
  }

  setColor(color) {
    this.currentColor = color;
  }

  setLineWidth(width) {
    this.currentWidth = width;
  }

  setFontSize(size) {
    this.currentFontSize = size;
  }

  updateCursor() {
    this.container.className = this.container.className.replace(/cursor-\w+/g, '').trim();
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
      e.preventDefault();
      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.setZoom(this.scale * zoomFactor, mouseX, mouseY);
    }, { passive: false });

    // Keyboard shortcuts (Spacebar for pan, Ctrl+Z for undo, Ctrl+Y for redo)
    window.addEventListener('keydown', (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

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
      if (e.code === 'Space') {
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

  getPointerPos(e) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  handlePointerDown(e) {
    if (!this.imageLoaded) return;
    const pos = this.getPointerPos(e);

    // Pan with Middle Click, Right Click, or Hand Tool or Space+Click
    if (e.button === 1 || e.button === 2 || this.currentTool === 'pan' || this.spacePressed) {
      this.isPanning = true;
      this.startPanX = pos.x - this.panX;
      this.startPanY = pos.y - this.panY;
      return;
    }

    if (e.button !== 0) return; // Only primary button for drawing

    const imgCoord = this.screenToImage(pos.x, pos.y);

    if (this.currentTool === 'text') {
      this.showInlineTextInput(pos.x, pos.y, imgCoord.x, imgCoord.y);
      return;
    }

    if (this.currentTool === 'eraser') {
      this.eraseAt(imgCoord.x, imgCoord.y);
      this.isDrawing = true;
      return;
    }

    // Quick Grading Stamps (O, X, Check, etc.)
    if (this.currentTool.startsWith('grade-')) {
      const stampObj = {
        id: Date.now() + Math.random(),
        type: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth,
        x: imgCoord.x,
        y: imgCoord.y,
        size: Math.max(32, this.currentFontSize * 2)
      };
      this.addObject(stampObj);
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
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
      if (this.currentPoints.length > 0) {
        const obj = {
          id: Date.now() + Math.random(),
          type: this.currentTool,
          color: this.currentColor,
          width: this.currentTool === 'highlighter' ? Math.max(14, this.currentWidth * 3.5) : this.currentWidth,
          opacity: this.currentTool === 'highlighter' ? 0.38 : 1.0,
          points: [...this.currentPoints]
        };
        this.addObject(obj);
      }
      this.currentPoints = [];
    } else if (['line', 'arrow', 'rect', 'circle'].includes(this.currentTool)) {
      if (this.shapeStart && this.shapeCurrent) {
        const obj = {
          id: Date.now() + Math.random(),
          type: this.currentTool,
          color: this.currentColor,
          width: this.currentWidth,
          startX: this.shapeStart.x,
          startY: this.shapeStart.y,
          endX: this.shapeCurrent.x,
          endY: this.shapeCurrent.y
        };
        this.addObject(obj);
      }
      this.shapeStart = null;
      this.shapeCurrent = null;
    }

    this.render();
  }

  showInlineTextInput(screenX, screenY, imgX, imgY) {
    if (this.activeTextInput) {
      this.commitTextInput();
    }

    const input = document.createElement('div');
    input.className = 'canvas-text-overlay';
    input.contentEditable = true;
    input.style.left = `${screenX}px`;
    input.style.top = `${screenY}px`;
    input.style.color = this.currentColor;
    input.style.fontSize = `${Math.max(14, this.currentFontSize * this.scale)}px`;
    input.setAttribute('placeholder', '텍스트 입력 후 Enter 또는 바깥 클릭...');

    this.container.appendChild(input);
    input.focus();

    const commit = () => {
      const text = input.innerText.trim();
      if (text) {
        const textObj = {
          id: Date.now() + Math.random(),
          type: 'text',
          text: text,
          color: this.currentColor,
          fontSize: this.currentFontSize,
          x: imgX,
          y: imgY
        };
        this.addObject(textObj);
      }
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
      this.activeTextInput = null;
      this.render();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        if (input.parentNode) input.parentNode.removeChild(input);
        this.activeTextInput = null;
      }
    });

    input.addEventListener('blur', () => {
      commit();
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
      if (obj.type === 'text') {
        const dx = obj.x - imgX;
        const dy = obj.y - imgY;
        return Math.sqrt(dx * dx + dy * dy) > eraseRadius + 15;
      }
      if (obj.points) {
        for (let pt of obj.points) {
          const dx = pt.x - imgX;
          const dy = pt.y - imgY;
          if (Math.sqrt(dx * dx + dy * dy) < eraseRadius) {
            return false; // Erase stroke
          }
        }
      }
      if (obj.startX !== undefined) {
        const midX = (obj.startX + obj.endX) / 2;
        const midY = (obj.startY + obj.endY) / 2;
        const dx = midX - imgX;
        const dy = midY - imgY;
        if (Math.sqrt(dx * dx + dy * dy) < eraseRadius + 20) {
          return false;
        }
      }
      if (obj.type.startsWith('grade-')) {
        const dx = obj.x - imgX;
        const dy = obj.y - imgY;
        if (Math.sqrt(dx * dx + dy * dy) < eraseRadius + 15) {
          return false;
        }
      }
      return true;
    });

    if (this.objects.length !== prevCount) {
      this.undoStack.push([...this.objects]);
      this.redoStack = [];
      this.render();
    }
  }

  addObject(obj) {
    this.objects.push(obj);
    this.undoStack.push([...this.objects]);
    this.redoStack = [];
    this.render();
  }

  undo() {
    if (this.objects.length === 0) return;
    const removed = this.objects.pop();
    this.redoStack.push(removed);
    this.render();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const restored = this.redoStack.pop();
    this.objects.push(restored);
    this.render();
  }

  clearAll() {
    if (this.objects.length === 0) return;
    this.redoStack = [...this.objects];
    this.objects = [];
    this.render();
  }

  // --- Rendering Loop ---
  render() {
    if (!this.canvas) return;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Clear background
    ctx.clearRect(0, 0, cw, ch);

    if (!this.imageLoaded || !this.bgImage) {
      ctx.fillStyle = '#64748b';
      ctx.font = '16px Pretendard, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('이미지를 불러오는 중이거나 선택된 이미지가 없습니다.', cw / 2, ch / 2);
      return;
    }

    ctx.save();

    // Apply Viewport Transform
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // Draw Background Image
    ctx.drawImage(this.bgImage, 0, 0, this.imgWidth, this.imgHeight);

    // Draw Objects
    for (let obj of this.objects) {
      this.drawObject(ctx, obj, 1.0);
    }

    // Draw in-progress Stroke
    if (this.isDrawing && (this.currentTool === 'pen' || this.currentTool === 'highlighter')) {
      if (this.currentPoints.length > 0) {
        this.drawObject(ctx, {
          type: this.currentTool,
          color: this.currentColor,
          width: this.currentTool === 'highlighter' ? Math.max(14, this.currentWidth * 3.5) : this.currentWidth,
          opacity: this.currentTool === 'highlighter' ? 0.38 : 1.0,
          points: this.currentPoints
        }, 1.0);
      }
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
    ctx.save();

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
      
      const headlen = 16 * scaleFactor;
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
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const w = obj.endX - obj.startX;
      const h = obj.endY - obj.startY;
      ctx.strokeRect(obj.startX, obj.startY, w, h);
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

      const lines = obj.text.split('\n');
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
      
      // Rounded rect background
      const rx = obj.x - padX;
      const ry = obj.y - padY;
      const rw = maxLineWidth + padX * 2;
      const rh = totalH + padY * 2;
      const r = 6 * scaleFactor;

      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, r);
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
      const r = (obj.size / 2) * scaleFactor;
      ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
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

    ctx.restore();
  }

  // --- High-Resolution Synthesis & Export ---
  exportAnnotatedImage() {
    if (!this.imageLoaded || !this.bgImage) return null;

    // Create offscreen canvas with original image's native resolution
    const offscreen = document.createElement('canvas');
    offscreen.width = this.imgWidth;
    offscreen.height = this.imgHeight;
    const offCtx = offscreen.getContext('2d');

    // 1. Draw original base image
    offCtx.drawImage(this.bgImage, 0, 0, this.imgWidth, this.imgHeight);

    // 2. Render all annotations at full 1:1 scale
    for (let obj of this.objects) {
      this.drawObject(offCtx, obj, 1.0);
    }

    // Export as high quality JPEG
    const dataUrl = offscreen.toDataURL('image/jpeg', 0.92);
    const vectorData = JSON.stringify(this.objects);

    return {
      dataUrl: dataUrl,
      vectorData: vectorData,
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
