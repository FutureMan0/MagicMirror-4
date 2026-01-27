// Visual Grid Editor for MagicMirror³ WebUI
// Vollständiger Drag & Drop Editor mit Resize-Handles

class VisualGridEditor {
  constructor(containerSelector, config, onUpdate) {
    this.container = document.querySelector(containerSelector);
    this.config = config;
    this.onUpdate = onUpdate;
    
    // Editor State
    this.state = {
      editMode: false,
      selectedModule: null,
      isDragging: false,
      isResizing: false,
      dragOffset: { x: 0, y: 0 },
      resizeHandle: null,
      dragStartPos: null,
      resizeStartSize: null,
      hoveredCell: null
    };
    
    // Device detection
    this.isMobile = window.innerWidth < 768;
    this.isTouch = 'ontouchstart' in window;
    
    // Initialisierung
    this.init();
  }
  
  init() {
    if (!this.container) {
      console.error('Visual Editor container not found');
      return;
    }
    
    // Editor-Container erstellen
    this.createEditorContainer();
    
    // Event Listeners
    this.setupEventListeners();
    
    // Responsive Updates
    window.addEventListener('resize', () => {
      this.isMobile = window.innerWidth < 768;
      this.render();
    });
    
    // Initial Render
    this.render();
  }
  
  createEditorContainer() {
    this.container.innerHTML = '';
    
    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.innerHTML = `
      <div class="editor-toolbar-left">
        <span class="editor-grid-info">Grid: ${this.getGridSettings().columns}x${this.getGridSettings().rows}</span>
        <button class="editor-toggle-btn" id="editor-toggle-mode">
          <span class="mode-icon">✏️</span>
          <span class="mode-text">Edit Mode: OFF</span>
        </button>
      </div>
      <div class="editor-toolbar-right">
        <button class="btn-secondary" id="editor-reset-layout">Reset</button>
        <button class="btn-primary" id="editor-save-layout">Speichern</button>
      </div>
    `;
    
    // Editor Canvas
    const canvas = document.createElement('div');
    canvas.className = 'visual-editor-canvas';
    canvas.id = 'editor-canvas';
    
    // Mobile Quick Actions (initially hidden)
    const quickActions = document.createElement('div');
    quickActions.className = 'mobile-quick-actions';
    quickActions.id = 'mobile-quick-actions';
    quickActions.style.display = 'none';
    quickActions.innerHTML = `
      <div class="quick-actions-header">
        <span class="selected-module-name"></span>
        <button class="quick-actions-close">×</button>
      </div>
      <div class="quick-actions-grid">
        <button class="quick-action-btn" data-action="move-up">↑</button>
        <button class="quick-action-btn" data-action="move-left">←</button>
        <button class="quick-action-btn" data-action="move-down">↓</button>
        <button class="quick-action-btn" data-action="move-right">→</button>
      </div>
      <div class="quick-actions-size">
        <button class="quick-action-btn" data-action="col-minus">Col -</button>
        <button class="quick-action-btn" data-action="col-plus">Col +</button>
        <button class="quick-action-btn" data-action="row-minus">Row -</button>
        <button class="quick-action-btn" data-action="row-plus">Row +</button>
      </div>
    `;
    
    this.container.appendChild(toolbar);
    this.container.appendChild(canvas);
    this.container.appendChild(quickActions);
    
    // Referenzen speichern
    this.toolbar = toolbar;
    this.canvas = canvas;
    this.quickActions = quickActions;
  }
  
  setupEventListeners() {
    // Toolbar Buttons
    const toggleBtn = document.getElementById('editor-toggle-mode');
    const saveBtn = document.getElementById('editor-save-layout');
    const resetBtn = document.getElementById('editor-reset-layout');
    
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleEditMode());
    }
    
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveLayout());
    }
    
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetLayout());
    }
    
    // Mobile Quick Actions
    const quickActionsClose = this.quickActions.querySelector('.quick-actions-close');
    if (quickActionsClose) {
      quickActionsClose.addEventListener('click', () => this.deselectModule());
    }
    
    const quickActionBtns = this.quickActions.querySelectorAll('.quick-action-btn');
    quickActionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        this.handleQuickAction(action);
      });
    });
  }
  
  getGridSettings() {
    const defaults = {
      columns: 3,
      rows: 3,
      gap: 12,
      padding: 12,
      columnSizes: ['1fr', '1fr', '1fr'],
      rowSizes: ['1fr', '1fr', '1fr']
    };
    
    if (this.config && this.config.gridSettings) {
      return { ...defaults, ...this.config.gridSettings };
    }
    
    return defaults;
  }
  
  getModules() {
    return this.config.modules || [];
  }
  
  render() {
    if (!this.canvas) return;
    
    const gridSettings = this.getGridSettings();
    const modules = this.getModules();
    
    console.log('Visual Editor render - Grid Settings:', gridSettings);
    
    // Canvas leeren
    this.canvas.innerHTML = '';
    
    // Canvas Grid konfigurieren
    const columnTemplate = gridSettings.columnSizes && gridSettings.columnSizes.length > 0
      ? gridSettings.columnSizes.join(' ')
      : `repeat(${gridSettings.columns}, 1fr)`;
    
    const rowTemplate = gridSettings.rowSizes && gridSettings.rowSizes.length > 0
      ? gridSettings.rowSizes.join(' ')
      : `repeat(${gridSettings.rows}, 1fr)`;
    
    // Setze Grid-Styles direkt als inline styles (haben höchste Priorität)
    this.canvas.style.cssText = `
      display: grid;
      grid-template-columns: ${columnTemplate};
      grid-template-rows: ${rowTemplate};
      gap: ${gridSettings.gap}px;
      padding: ${gridSettings.padding || 20}px;
    `;
    
    console.log('Canvas Grid Template:', columnTemplate, rowTemplate);
    
    // Grid-Linien rendern (nur im Edit Mode)
    if (this.state.editMode) {
      this.renderGridLines();
    }
    
    // Module rendern
    modules.forEach((module, index) => {
      if (module.enabled === false) return;
      this.renderModule(module, index);
    });
    
    // Grid-Info aktualisieren
    const gridInfo = this.toolbar?.querySelector('.editor-grid-info');
    if (gridInfo) {
      gridInfo.textContent = `Grid: ${gridSettings.columns}x${gridSettings.rows}`;
    }
  }
  
  renderGridLines() {
    const gridSettings = this.getGridSettings();
    const gridLines = document.createElement('div');
    gridLines.className = 'editor-grid-lines';
    
    // Dynamisches Grid generieren - verwende die gleichen Werte wie das Canvas
    const columnTemplate = gridSettings.columnSizes && gridSettings.columnSizes.length > 0
      ? gridSettings.columnSizes.join(' ')
      : `repeat(${gridSettings.columns}, 1fr)`;
    
    const rowTemplate = gridSettings.rowSizes && gridSettings.rowSizes.length > 0
      ? gridSettings.rowSizes.join(' ')
      : `repeat(${gridSettings.rows}, 1fr)`;
    
    // Setze Grid-Styles als inline styles (höchste Priorität)
    gridLines.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: grid;
      grid-template-columns: ${columnTemplate};
      grid-template-rows: ${rowTemplate};
      gap: ${gridSettings.gap}px;
      padding: ${gridSettings.padding || 20}px;
      pointer-events: none;
      z-index: 1;
    `;
    
    // Grid-Zellen erstellen
    for (let row = 1; row <= gridSettings.rows; row++) {
      for (let col = 1; col <= gridSettings.columns; col++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.row = row;
        cell.dataset.col = col;
        
        if (this.state.hoveredCell?.row === row && this.state.hoveredCell?.col === col) {
          cell.classList.add('hovered');
        }
        
        gridLines.appendChild(cell);
      }
    }
    
    this.canvas.appendChild(gridLines);
  }
  
  renderModule(module, index) {
    const moduleEl = document.createElement('div');
    moduleEl.className = 'editor-module';
    moduleEl.dataset.index = index;
    
    if (this.state.selectedModule === index) {
      moduleEl.classList.add('selected');
    }
    
    // Position berechnen
    const position = this.calculateModulePosition(module.position);
    if (!position) {
      console.warn('Could not calculate position for module:', module.module, module.position);
      return;
    }
    
    console.log(`Module ${module.module}: Position`, position);
    
    // Grid-Position mit Z-Index für korrekte Überlappung
    moduleEl.style.gridColumn = position.gridColumn;
    moduleEl.style.gridRow = position.gridRow;
    moduleEl.style.zIndex = '2'; // Über den Grid-Linien
    
    // Modul-Name
    const moduleName = document.createElement('div');
    moduleName.className = 'editor-module-name';
    moduleName.textContent = this.getModuleDisplayName(module.module);
    moduleEl.appendChild(moduleName);
    
    // Position-Info (immer anzeigen)
    const posInfo = document.createElement('div');
    posInfo.className = 'editor-module-info';
    posInfo.textContent = `${position.col},${position.row} (${position.colSpan}×${position.rowSpan})`;
    moduleEl.appendChild(posInfo);
    
    // Resize Handles (nur Desktop & Edit Mode & Selected)
    if (this.state.editMode && !this.isMobile && this.state.selectedModule === index) {
      this.addResizeHandles(moduleEl);
    }
    
    // Event Listeners
    this.addModuleEventListeners(moduleEl, index);
    
    this.canvas.appendChild(moduleEl);
  }
  
  calculateModulePosition(position) {
    const gridSettings = this.getGridSettings();
    
    // Legacy String-Position
    if (typeof position === 'string') {
      return this.legacyPositionToGrid(position);
    }
    
    // Grid-Position
    if (position.column !== undefined && position.row !== undefined) {
      return {
        col: position.column,
        row: position.row,
        colSpan: position.columnSpan || 1,
        rowSpan: position.rowSpan || 1,
        gridColumn: `${position.column} / span ${position.columnSpan || 1}`,
        gridRow: `${position.row} / span ${position.rowSpan || 1}`
      };
    }
    
    // Absolute Position (nicht im Grid Editor)
    if (position.x !== undefined || position.y !== undefined) {
      return null; // Absolute positionierte Module nicht im Grid Editor
    }
    
    return null;
  }
  
  legacyPositionToGrid(posString) {
    const gridSettings = this.getGridSettings();
    const cols = gridSettings.columns;
    const rows = gridSettings.rows;
    
    // Berechne dynamisch basierend auf Grid-Größe
    const leftCol = 1;
    const centerCol = Math.ceil(cols / 2);
    const rightCol = cols;
    
    const topRow = 1;
    const middleRow = Math.ceil(rows / 2);
    const bottomRow = rows;
    
    const map = {
      'top_left': { col: leftCol, row: topRow },
      'top_center': { col: centerCol, row: topRow },
      'top_right': { col: rightCol, row: topRow },
      'middle_left': { col: leftCol, row: middleRow },
      'middle_center': { col: centerCol, row: middleRow },
      'middle_right': { col: rightCol, row: middleRow },
      'bottom_left': { col: leftCol, row: bottomRow },
      'bottom_center': { col: centerCol, row: bottomRow },
      'bottom_right': { col: rightCol, row: bottomRow }
    };
    
    const pos = map[posString];
    if (!pos) return null;
    
    return {
      col: pos.col,
      row: pos.row,
      colSpan: 1,
      rowSpan: 1,
      gridColumn: `${pos.col} / span 1`,
      gridRow: `${pos.row} / span 1`
    };
  }
  
  getModuleDisplayName(moduleName) {
    // Mapping für Anzeigenamen
    const names = {
      'clock': 'Uhr',
      'weather': 'Wetter',
      'untis': 'Stundenplan',
      'spotify': 'Spotify',
      'calendar': 'Kalender'
    };
    return names[moduleName] || moduleName;
  }
  
  addResizeHandles(moduleEl) {
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const moduleIndex = parseInt(moduleEl.dataset.index);
    
    console.log('Adding resize handles to module', moduleIndex);
    
    handles.forEach(handle => {
      const handleEl = document.createElement('div');
      handleEl.className = `resize-handle resize-handle-${handle}`;
      handleEl.dataset.handle = handle;
      handleEl.style.position = 'absolute';
      handleEl.style.background = '#00D4FF';
      handleEl.style.border = '2px solid #000';
      handleEl.style.borderRadius = '3px';
      handleEl.style.zIndex = '20';
      handleEl.style.pointerEvents = 'auto';
      
      // EVENT-LISTENER DIREKT AN DAS HANDLE ANHÄNGEN
      const resizeStart = (e) => {
        if (!this.state.editMode) return;
        console.log('HANDLE CLICKED:', handle, 'for module', moduleIndex);
        e.stopPropagation(); // WICHTIG: Verhindere, dass Event zum Modul geht
        e.preventDefault();
        this.handleResizeStart(e, moduleIndex);
      };
      
      // Desktop
      handleEl.addEventListener('mousedown', resizeStart);
      
      // Mobile
      handleEl.addEventListener('touchstart', resizeStart, { passive: false });
      
      moduleEl.appendChild(handleEl);
      console.log(`Added handle: ${handle}`);
    });
    
    console.log('Total handles added:', moduleEl.querySelectorAll('.resize-handle').length);
  }
  
  addModuleEventListeners(moduleEl, index) {
    // Click/Tap zum Auswählen
    moduleEl.addEventListener('click', (e) => {
      if (!this.state.editMode) return;
      
      // Verhindere Propagation von Resize-Handles
      if (e.target.classList.contains('resize-handle')) return;
      
      this.selectModule(index);
      e.stopPropagation();
    });
    
    // Desktop: Drag & Drop (nur im Edit Mode)
    if (!this.isMobile) {
      moduleEl.addEventListener('mousedown', (e) => {
        if (!this.state.editMode) return;
        
        // WICHTIG: Ignoriere Resize-Handles!
        if (e.target.classList.contains('resize-handle')) {
          console.log('Module mousedown: ignoring handle click');
          return;
        }
        
        this.handleDragStart(e, index);
      });
    }
    
    // Touch: Drag & Drop (nur Tablet/iPad, nur im Edit Mode)
    if (this.isTouch && !this.isMobile) {
      moduleEl.addEventListener('touchstart', (e) => {
        if (!this.state.editMode) return;
        
        // WICHTIG: Ignoriere Resize-Handles!
        if (e.target.classList.contains('resize-handle')) {
          console.log('Module touchstart: ignoring handle touch');
          return;
        }
        
        this.handleDragStart(e, index);
      });
    }
  }
  
  selectModule(index) {
    console.log('Selecting module:', index);
    this.state.selectedModule = index;
    
    if (this.isMobile) {
      // Mobile: Quick Actions zeigen
      this.showMobileQuickActions(index);
    }
    
    this.render();
  }
  
  deselectModule() {
    this.state.selectedModule = null;
    
    if (this.isMobile) {
      this.quickActions.style.display = 'none';
    }
    
    this.render();
  }
  
  showMobileQuickActions(index) {
    const module = this.getModules()[index];
    if (!module) return;
    
    const moduleName = this.quickActions.querySelector('.selected-module-name');
    if (moduleName) {
      moduleName.textContent = this.getModuleDisplayName(module.module);
    }
    
    this.quickActions.style.display = 'block';
  }
  
  handleQuickAction(action) {
    if (this.state.selectedModule === null) return;
    
    const modules = this.getModules();
    const module = modules[this.state.selectedModule];
    if (!module) return;
    
    let position = module.position;
    
    // Konvertiere zu Grid-Position falls Legacy
    if (typeof position === 'string') {
      const gridPos = this.legacyPositionToGrid(position);
      position = {
        column: gridPos.col,
        row: gridPos.row,
        columnSpan: 1,
        rowSpan: 1,
        align: 'start',
        justify: 'start'
      };
    }
    
    const gridSettings = this.getGridSettings();
    
    // Position ändern
    switch (action) {
      case 'move-up':
        if (position.row > 1) position.row--;
        break;
      case 'move-down':
        if (position.row < gridSettings.rows) position.row++;
        break;
      case 'move-left':
        if (position.column > 1) position.column--;
        break;
      case 'move-right':
        if (position.column < gridSettings.columns) position.column++;
        break;
      case 'col-plus':
        if (position.column + (position.columnSpan || 1) <= gridSettings.columns) {
          position.columnSpan = (position.columnSpan || 1) + 1;
        }
        break;
      case 'col-minus':
        if ((position.columnSpan || 1) > 1) {
          position.columnSpan = (position.columnSpan || 1) - 1;
        }
        break;
      case 'row-plus':
        if (position.row + (position.rowSpan || 1) <= gridSettings.rows) {
          position.rowSpan = (position.rowSpan || 1) + 1;
        }
        break;
      case 'row-minus':
        if ((position.rowSpan || 1) > 1) {
          position.rowSpan = (position.rowSpan || 1) - 1;
        }
        break;
    }
    
    module.position = position;
    this.render();
    
    // Auto-Save nach kurzer Verzögerung
    clearTimeout(this.autoSaveTimeout);
    this.autoSaveTimeout = setTimeout(() => {
      if (this.onUpdate) {
        this.onUpdate(this.config);
      }
    }, 1000);
  }
  
  handleDragStart(e, index) {
    if (!this.state.editMode) {
      console.log('Drag start ignored - edit mode is off');
      return;
    }
    
    // Check if it's a resize handle
    const isResizeHandle = e.target.classList.contains('resize-handle');
    
    console.log('Drag start:', {
      isResizeHandle,
      target: e.target.className,
      editMode: this.state.editMode
    });
    
    if (isResizeHandle) {
      this.handleResizeStart(e, index);
    } else {
      this.startDrag(e, index);
    }
  }
  
  startDrag(e, index) {
    e.preventDefault();
    
    this.state.isDragging = true;
    this.state.selectedModule = index;
    
    const moduleEl = this.canvas.querySelector(`[data-index="${index}"]`);
    if (!moduleEl) return;
    
    // Berechne Offset
    const rect = moduleEl.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    this.state.dragOffset = {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
    
    this.state.dragStartPos = {
      x: rect.left - canvasRect.left,
      y: rect.top - canvasRect.top
    };
    
    // Add dragging class
    moduleEl.classList.add('dragging');
    
    // Event Listeners für Drag
    const moveHandler = (e) => this.handleDragMove(e, index);
    const endHandler = (e) => this.handleDragEnd(e, index, moveHandler, endHandler);
    
    if (this.isTouch) {
      document.addEventListener('touchmove', moveHandler, { passive: false });
      document.addEventListener('touchend', endHandler);
    } else {
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', endHandler);
    }
    
    this.render();
  }
  
  handleDragMove(e, index) {
    if (!this.state.isDragging) return;
    
    e.preventDefault();
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    const canvasRect = this.canvas.getBoundingClientRect();
    const gridSettings = this.getGridSettings();
    
    // Berechne Maus-Position im Canvas
    const mouseX = clientX - canvasRect.left;
    const mouseY = clientY - canvasRect.top;
    
    // Hole Grid-Linien um die tatsächlichen Zell-Positionen zu ermitteln
    const gridLines = this.canvas.querySelector('.editor-grid-lines');
    if (gridLines) {
      const cells = gridLines.querySelectorAll('.grid-cell');
      let hoveredCol = 1;
      let hoveredRow = 1;
      let minDistance = Infinity;
      
      cells.forEach(cell => {
        const cellRect = cell.getBoundingClientRect();
        const cellCenterX = cellRect.left + cellRect.width / 2 - canvasRect.left;
        const cellCenterY = cellRect.top + cellRect.height / 2 - canvasRect.top;
        
        const distance = Math.sqrt(
          Math.pow(mouseX - cellCenterX, 2) + 
          Math.pow(mouseY - cellCenterY, 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          hoveredCol = parseInt(cell.dataset.col);
          hoveredRow = parseInt(cell.dataset.row);
        }
      });
      
      // Update hovered cell
      this.state.hoveredCell = { col: hoveredCol, row: hoveredRow };
      
      // Visual feedback
      this.updateDragVisual(index, hoveredCol, hoveredRow);
    }
  }
  
  updateDragVisual(index, col, row) {
    const moduleEl = this.canvas.querySelector(`[data-index="${index}"]`);
    if (!moduleEl) return;
    
    const module = this.getModules()[index];
    const position = this.calculateModulePosition(module.position);
    
    if (!position) return;
    
    // Temporäre Position während Drag
    moduleEl.style.gridColumn = `${col} / span ${position.colSpan}`;
    moduleEl.style.gridRow = `${row} / span ${position.rowSpan}`;
    moduleEl.style.opacity = '0.7';
    
    // Grid-Linien aktualisieren
    const gridLines = this.canvas.querySelector('.editor-grid-lines');
    if (gridLines) {
      const cells = gridLines.querySelectorAll('.grid-cell');
      cells.forEach(cell => {
        const cellCol = parseInt(cell.dataset.col);
        const cellRow = parseInt(cell.dataset.row);
        
        // Highlight cells that would be occupied
        const isOccupied = cellCol >= col && cellCol < col + position.colSpan &&
                          cellRow >= row && cellRow < row + position.rowSpan;
        
        cell.classList.toggle('hovered', isOccupied);
      });
    }
  }
  
  handleDragEnd(e, index, moveHandler, endHandler) {
    if (!this.state.isDragging) return;
    
    e.preventDefault();
    
    // Remove event listeners
    if (this.isTouch) {
      document.removeEventListener('touchmove', moveHandler);
      document.removeEventListener('touchend', endHandler);
    } else {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', endHandler);
    }
    
    const moduleEl = this.canvas.querySelector(`[data-index="${index}"]`);
    if (moduleEl) {
      moduleEl.classList.remove('dragging');
      moduleEl.style.opacity = '';
    }
    
    // Snap to grid
    if (this.state.hoveredCell) {
      this.snapModuleToGrid(index, this.state.hoveredCell.col, this.state.hoveredCell.row);
    }
    
    this.state.isDragging = false;
    this.state.hoveredCell = null;
    
    this.render();
    
    // Auto-save
    clearTimeout(this.autoSaveTimeout);
    this.autoSaveTimeout = setTimeout(() => {
      if (this.onUpdate) {
        this.onUpdate(this.config);
      }
    }, 1000);
  }
  
  snapModuleToGrid(index, col, row) {
    const modules = this.getModules();
    const module = modules[index];
    if (!module) return;
    
    let position = module.position;
    const gridSettings = this.getGridSettings();
    
    // Konvertiere Legacy zu Grid
    if (typeof position === 'string') {
      const gridPos = this.legacyPositionToGrid(position);
      position = {
        column: gridPos.col,
        row: gridPos.row,
        columnSpan: 1,
        rowSpan: 1,
        align: 'start',
        justify: 'start'
      };
    }
    
    // Ensure columnSpan and rowSpan are defined
    const columnSpan = position.columnSpan || 1;
    const rowSpan = position.rowSpan || 1;
    
    // Check bounds
    if (col + columnSpan - 1 > gridSettings.columns) {
      col = gridSettings.columns - columnSpan + 1;
    }
    
    if (row + rowSpan - 1 > gridSettings.rows) {
      row = gridSettings.rows - rowSpan + 1;
    }
    
    // Update position
    position.column = col;
    position.row = row;
    position.columnSpan = columnSpan;
    position.rowSpan = rowSpan;
    
    module.position = position;
  }
  
  handleResizeStart(e, index) {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('RESIZE START - Handle:', e.target.dataset.handle);
    
    this.state.isResizing = true;
    this.state.selectedModule = index;
    this.state.resizeHandle = e.target.dataset.handle;
    
    const module = this.getModules()[index];
    const position = this.calculateModulePosition(module.position);
    
    if (!position) {
      console.error('Could not calculate position for resize start');
      return;
    }
    
    this.state.resizeStartSize = {
      col: position.col,
      row: position.row,
      colSpan: position.colSpan,
      rowSpan: position.rowSpan
    };
    
    console.log('Resize start size:', this.state.resizeStartSize);
    
    // Event Listeners für Resize
    const moveHandler = (e) => this.handleResizeMove(e, index);
    const endHandler = (e) => this.handleResizeEnd(e, index, moveHandler, endHandler);
    
    if (this.isTouch) {
      document.addEventListener('touchmove', moveHandler, { passive: false });
      document.addEventListener('touchend', endHandler);
    } else {
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', endHandler);
    }
  }
  
  handleResizeMove(e, index) {
    if (!this.state.isResizing) return;
    
    e.preventDefault();
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    if (!clientX || !clientY) return;
    
    const canvasRect = this.canvas.getBoundingClientRect();
    const gridSettings = this.getGridSettings();
    
    // Berechne Maus-Position im Canvas
    const mouseX = clientX - canvasRect.left;
    const mouseY = clientY - canvasRect.top;
    
    // Ermittle Grid-Position basierend auf tatsächlichen Grid-Zellen
    const gridLines = this.canvas.querySelector('.editor-grid-lines');
    let col = 1;
    let row = 1;
    
    if (gridLines) {
      const cells = gridLines.querySelectorAll('.grid-cell');
      let minDistance = Infinity;
      
      cells.forEach(cell => {
        const cellRect = cell.getBoundingClientRect();
        const cellCenterX = cellRect.left + cellRect.width / 2 - canvasRect.left;
        const cellCenterY = cellRect.top + cellRect.height / 2 - canvasRect.top;
        
        const distance = Math.sqrt(
          Math.pow(mouseX - cellCenterX, 2) + 
          Math.pow(mouseY - cellCenterY, 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          col = parseInt(cell.dataset.col);
          row = parseInt(cell.dataset.row);
        }
      });
    }
    
    const startSize = this.state.resizeStartSize;
    const handle = this.state.resizeHandle;
    
    console.log('Resize move:', {
      handle,
      mouseCol: col,
      mouseRow: row,
      startSize
    });
    
    let newCol = startSize.col;
    let newRow = startSize.row;
    let newColSpan = startSize.colSpan;
    let newRowSpan = startSize.rowSpan;
    
    // Berechne neue Größe basierend auf Handle
    switch (handle) {
      case 'nw': // Nord-West
        newCol = Math.min(col, startSize.col + startSize.colSpan - 1);
        newRow = Math.min(row, startSize.row + startSize.rowSpan - 1);
        newColSpan = startSize.col + startSize.colSpan - newCol;
        newRowSpan = startSize.row + startSize.rowSpan - newRow;
        break;
        
      case 'n': // Nord
        newRow = Math.min(row, startSize.row + startSize.rowSpan - 1);
        newRowSpan = startSize.row + startSize.rowSpan - newRow;
        break;
        
      case 'ne': // Nord-Ost
        newRow = Math.min(row, startSize.row + startSize.rowSpan - 1);
        newColSpan = Math.max(1, col - startSize.col + 1);
        newRowSpan = startSize.row + startSize.rowSpan - newRow;
        break;
        
      case 'e': // Ost
        newColSpan = Math.max(1, col - startSize.col + 1);
        break;
        
      case 'se': // Süd-Ost
        newColSpan = Math.max(1, col - startSize.col + 1);
        newRowSpan = Math.max(1, row - startSize.row + 1);
        break;
        
      case 's': // Süd
        newRowSpan = Math.max(1, row - startSize.row + 1);
        break;
        
      case 'sw': // Süd-West
        newCol = Math.min(col, startSize.col + startSize.colSpan - 1);
        newColSpan = startSize.col + startSize.colSpan - newCol;
        newRowSpan = Math.max(1, row - startSize.row + 1);
        break;
        
      case 'w': // West
        newCol = Math.min(col, startSize.col + startSize.colSpan - 1);
        newColSpan = startSize.col + startSize.colSpan - newCol;
        break;
    }
    
    // Bounds checking
    newCol = Math.max(1, newCol);
    newRow = Math.max(1, newRow);
    newColSpan = Math.max(1, Math.min(newColSpan, gridSettings.columns - newCol + 1));
    newRowSpan = Math.max(1, Math.min(newRowSpan, gridSettings.rows - newRow + 1));
    
    console.log('New size calculated:', {
      newCol,
      newRow,
      newColSpan,
      newRowSpan
    });
    
    // Visual feedback
    this.updateResizeVisual(index, newCol, newRow, newColSpan, newRowSpan);
  }
  
  updateResizeVisual(index, col, row, colSpan, rowSpan) {
    const moduleEl = this.canvas.querySelector(`[data-index="${index}"]`);
    if (!moduleEl) {
      console.warn('Module element not found for resize visual update');
      return;
    }
    
    console.log('Updating visual:', {
      gridColumn: `${col} / span ${colSpan}`,
      gridRow: `${row} / span ${rowSpan}`
    });
    
    moduleEl.style.gridColumn = `${col} / span ${colSpan}`;
    moduleEl.style.gridRow = `${row} / span ${rowSpan}`;
    moduleEl.style.opacity = '0.8';
    moduleEl.style.transition = 'none'; // Keine Transition während Resize
    
    // Update info text
    const infoEl = moduleEl.querySelector('.editor-module-info');
    if (infoEl) {
      infoEl.textContent = `${col},${row} (${colSpan}×${rowSpan})`;
    }
    
    // Highlight grid cells
    const gridLines = this.canvas.querySelector('.editor-grid-lines');
    if (gridLines) {
      const cells = gridLines.querySelectorAll('.grid-cell');
      cells.forEach(cell => {
        const cellCol = parseInt(cell.dataset.col);
        const cellRow = parseInt(cell.dataset.row);
        
        const isOccupied = cellCol >= col && cellCol < col + colSpan &&
                          cellRow >= row && cellRow < row + rowSpan;
        
        cell.classList.toggle('hovered', isOccupied);
      });
    }
  }
  
  handleResizeEnd(e, index, moveHandler, endHandler) {
    if (!this.state.isResizing) return;
    
    e.preventDefault();
    
    console.log('Resize ended');
    
    // Remove event listeners
    if (this.isTouch) {
      document.removeEventListener('touchmove', moveHandler);
      document.removeEventListener('touchend', endHandler);
    } else {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', endHandler);
    }
    
    const moduleEl = this.canvas.querySelector(`[data-index="${index}"]`);
    if (moduleEl) {
      moduleEl.style.opacity = '';
      moduleEl.style.transition = ''; // Transition wieder aktivieren
    }
    
    // Apply final size
    this.applyResize(index);
    
    this.state.isResizing = false;
    this.state.resizeHandle = null;
    this.state.resizeStartSize = null;
    
    this.render();
    
    // Auto-save
    clearTimeout(this.autoSaveTimeout);
    this.autoSaveTimeout = setTimeout(() => {
      console.log('Auto-saving after resize');
      if (this.onUpdate) {
        this.onUpdate(this.config);
      }
    }, 1000);
  }
  
  applyResize(index) {
    const moduleEl = this.canvas.querySelector(`[data-index="${index}"]`);
    if (!moduleEl) {
      console.warn('Module element not found for index:', index);
      return;
    }
    
    const modules = this.getModules();
    const module = modules[index];
    if (!module) {
      console.warn('Module not found in config for index:', index);
      return;
    }
    
    // Parse current visual position
    const gridColumnStyle = moduleEl.style.gridColumn;
    const gridRowStyle = moduleEl.style.gridRow;
    
    console.log('Applying resize - gridColumn:', gridColumnStyle, 'gridRow:', gridRowStyle);
    
    // Versuche "X / span Y" Format zu matchen
    let colMatch = gridColumnStyle.match(/(\d+)\s*\/\s*span\s*(\d+)/);
    let rowMatch = gridRowStyle.match(/(\d+)\s*\/\s*span\s*(\d+)/);
    
    // Fallback: Nur eine Zahl (ohne span)
    if (!colMatch) {
      const simpleColMatch = gridColumnStyle.match(/^(\d+)$/);
      if (simpleColMatch) {
        colMatch = [gridColumnStyle, simpleColMatch[1], '1'];
      }
    }
    
    if (!rowMatch) {
      const simpleRowMatch = gridRowStyle.match(/^(\d+)$/);
      if (simpleRowMatch) {
        rowMatch = [gridRowStyle, simpleRowMatch[1], '1'];
      }
    }
    
    if (!colMatch || !rowMatch) {
      console.warn('Could not parse grid position:', gridColumnStyle, gridRowStyle);
      return;
    }
    
    const col = parseInt(colMatch[1]);
    const colSpan = parseInt(colMatch[2]);
    const row = parseInt(rowMatch[1]);
    const rowSpan = parseInt(rowMatch[2]);
    
    console.log('Parsed position:', { col, row, colSpan, rowSpan });
    
    let position = module.position;
    
    // Konvertiere Legacy zu Grid
    if (typeof position === 'string') {
      position = {
        column: col,
        row: row,
        columnSpan: colSpan,
        rowSpan: rowSpan,
        align: 'start',
        justify: 'start'
      };
    } else {
      position.column = col;
      position.row = row;
      position.columnSpan = colSpan;
      position.rowSpan = rowSpan;
    }
    
    module.position = position;
    console.log('Updated module position:', module.position);
  }
  
  toggleEditMode() {
    this.state.editMode = !this.state.editMode;
    
    console.log('Edit mode toggled:', this.state.editMode ? 'ON' : 'OFF');
    
    const toggleBtn = document.getElementById('editor-toggle-mode');
    const modeText = toggleBtn?.querySelector('.mode-text');
    const modeIcon = toggleBtn?.querySelector('.mode-icon');
    
    if (this.state.editMode) {
      if (modeText) modeText.textContent = 'Edit Mode: ON';
      if (modeIcon) modeIcon.textContent = '🔓';
      toggleBtn?.classList.add('active');
    } else {
      if (modeText) modeText.textContent = 'Edit Mode: OFF';
      if (modeIcon) modeIcon.textContent = '🔒';
      toggleBtn?.classList.remove('active');
      this.deselectModule();
    }
    
    this.render();
  }
  
  saveLayout() {
    if (this.onUpdate) {
      this.onUpdate(this.config);
    }
    
    // Visual Feedback
    const saveBtn = document.getElementById('editor-save-layout');
    if (saveBtn) {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '✓ Gespeichert!';
      saveBtn.disabled = true;
      
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 2000);
    }
  }
  
  resetLayout() {
    if (confirm('Layout zurücksetzen? Ungespeicherte Änderungen gehen verloren.')) {
      // Reload config from server
      window.location.reload();
    }
  }
  
  updateConfig(newConfig) {
    this.config = newConfig;
    this.render();
  }
}

// Export für globalen Zugriff
window.VisualGridEditor = VisualGridEditor;
