package dispatcher

import (
	"context"
	"fmt"
)

type IDEEventEmitter struct {
	ctx    context.Context
	emitFn func(string, ...interface{}) error
}

func NewIDEEventEmitter(ctx context.Context) *IDEEventEmitter {
	return &IDEEventEmitter{
		ctx: ctx,
	}
}

func NewIDEEventEmitterWithEmit(ctx context.Context, emitFn func(string, ...interface{}) error) *IDEEventEmitter {
	return &IDEEventEmitter{
		ctx:    ctx,
		emitFn: emitFn,
	}
}

const (
	defaultPreviewWindowID = "preview-browser-default"
)

func (e *IDEEventEmitter) RegisterHandlers(d *Dispatcher) {
	d.RegisterHandler("panel.git", e.handleOpenGitPanel)
	d.RegisterHandler("panel.ai", e.handleOpenAIPanel)
	d.RegisterHandler("panel.terminal", e.handleOpenTerminal)
	d.RegisterHandler("panel.explorer", e.handleOpenExplorer)
	d.RegisterHandler("panel.problems", e.handleOpenProblems)
	d.RegisterHandler("panel.search", e.handleOpenSearch)
	d.RegisterHandler("panel.run", e.handleOpenRun)
	d.RegisterHandler("panel.debug", e.handleOpenDebug)
	d.RegisterHandler("panel.close.explorer", e.handleClosePanel("explorer"))
	d.RegisterHandler("panel.close.terminal", e.handleClosePanel("terminal"))
	d.RegisterHandler("panel.close.ai", e.handleClosePanel("ai"))
	d.RegisterHandler("panel.close.git", e.handleClosePanel("git"))
	d.RegisterHandler("panel.close.problems", e.handleClosePanel("problems"))

	d.RegisterHandler("shortcut.explorer.toggle", e.handleMenuAction("explorer.toggle"))
	d.RegisterHandler("shortcut.terminal.toggle", e.handleMenuAction("terminal.toggle"))
	d.RegisterHandler("shortcut.terminal.fullscreen", e.handleMenuAction("terminal.fullscreen"))
	d.RegisterHandler("shortcut.ai.toggle", e.handleMenuAction("ai.toggle"))
	d.RegisterHandler("shortcut.ai.fullscreen", e.handleMenuAction("ai.fullscreen"))
	d.RegisterHandler("shortcut.git.toggle", e.handleMenuAction("git.toggle"))
	d.RegisterHandler("shortcut.git.fullscreen", e.handleMenuAction("git.fullscreen"))
	d.RegisterHandler("shortcut.problems.toggle", e.handleMenuAction("problems.toggle"))
	d.RegisterHandler("shortcut.problems.fullscreen", e.handleMenuAction("problems.fullscreen"))
	d.RegisterHandler("shortcut.panel.closeFullscreen", e.handleMenuAction("panel.closeFullscreen"))
	d.RegisterHandler("shortcut.browser.preview", e.handleMenuAction("browser.preview"))
	d.RegisterHandler("shortcut.window.toggleFullscreen", e.handleMenuAction("window.toggleFullscreen"))
	d.RegisterHandler("shortcut.project.copyPath", e.handleMenuAction("project.copyPath"))
	d.RegisterHandler("shortcut.project.open", e.handleMenuAction("project.open"))
	d.RegisterHandler("shortcut.project.new", e.handleMenuAction("project.new"))
	d.RegisterHandler("shortcut.zenMode.toggle", e.handleMenuAction("zenMode.toggle"))

	d.RegisterHandler("panel.move.leftToRight", e.handleMovePanelSide("left", "right"))
	d.RegisterHandler("panel.move.leftToTop", e.handleMovePanelSide("left", "top"))
	d.RegisterHandler("panel.move.leftToBottom", e.handleMovePanelSide("left", "bottom"))
	d.RegisterHandler("panel.move.rightToLeft", e.handleMovePanelSide("right", "left"))
	d.RegisterHandler("panel.move.rightToTop", e.handleMovePanelSide("right", "top"))
	d.RegisterHandler("panel.move.rightToBottom", e.handleMovePanelSide("right", "bottom"))
	d.RegisterHandler("panel.move.topToLeft", e.handleMovePanelSide("top", "left"))
	d.RegisterHandler("panel.move.topToRight", e.handleMovePanelSide("top", "right"))
	d.RegisterHandler("panel.move.topToBottom", e.handleMovePanelSide("top", "bottom"))
	d.RegisterHandler("panel.move.bottomToLeft", e.handleMovePanelSide("bottom", "left"))
	d.RegisterHandler("panel.move.bottomToRight", e.handleMovePanelSide("bottom", "right"))
	d.RegisterHandler("panel.move.bottomToTop", e.handleMovePanelSide("bottom", "top"))

	d.RegisterHandler("toggle.sidebar", e.handleToggleSidebar)
	d.RegisterHandler("toggle.terminal", e.handleToggleTerminal)
	d.RegisterHandler("toggle.ai", e.handleToggleAI)

	d.RegisterHandler("editor.splitVertical", e.handleSplitVertical)
	d.RegisterHandler("editor.splitHorizontal", e.handleSplitHorizontal)
	d.RegisterHandler("editor.closeTab", e.handleCloseTab)
	d.RegisterHandler("editor.closeAllTabs", e.handleCloseAllTabs)
	d.RegisterHandler("editor.closeOtherTabs", e.handleCloseOtherTabs)
	d.RegisterHandler("editor.format", e.handleFormat)
	d.RegisterHandler("editor.goToLine", e.handleGoToLine)
	d.RegisterHandler("editor.goToDefinition", e.handleGoToDefinition)
	d.RegisterHandler("editor.toggleWordWrap", e.handleToggleWordWrap)
	d.RegisterHandler("editor.toggleMinimap", e.handleToggleMinimap)

	d.RegisterHandler("file.new", e.handleNewFile)
	d.RegisterHandler("file.save", e.handleSave)
	d.RegisterHandler("file.saveAll", e.handleSaveAll)

	d.RegisterHandler("view.zoomIn", e.handleZoomIn)
	d.RegisterHandler("view.zoomOut", e.handleZoomOut)
	d.RegisterHandler("view.zoomReset", e.handleZoomReset)

	d.RegisterHandler("app.settings", e.handleOpenSettings)
	d.RegisterHandler("app.keybindings", e.handleShowKeybindings)
	d.RegisterHandler("app.reload", e.handleReload)

	d.RegisterHandler("git.status", e.handleGitStatus)
	d.RegisterHandler("git.commit", e.handleGitCommit)
	d.RegisterHandler("git.push", e.handleGitPush)
	d.RegisterHandler("git.pull", e.handleGitPull)
	d.RegisterHandler("preview.open", e.handlePreviewOpen)
	d.RegisterHandler("preview.move.left", e.handleMoveBrowserPreview("left"))
	d.RegisterHandler("preview.move.right", e.handleMoveBrowserPreview("right"))
	d.RegisterHandler("preview.move.top", e.handleMoveBrowserPreview("top"))
	d.RegisterHandler("preview.move.bottom", e.handleMoveBrowserPreview("bottom"))
	d.RegisterHandler("preview.focus", e.handlePreviewFocus)
	d.RegisterHandler("preview.close", e.handlePreviewClose)
}

func (e *IDEEventEmitter) emit(event string, data ...interface{}) error {
	if e.emitFn != nil {
		return e.emitFn(event, data...)
	}
	if e.ctx == nil {
		return fmt.Errorf("context not initialized")
	}
	return fmt.Errorf("event emitter is not initialized")
}

func defaultPreviewWindowIDPayload() map[string]any {
	return map[string]any{"id": defaultPreviewWindowID}
}

func (e *IDEEventEmitter) handleOpenGitPanel(_ *IDEAction) error {
	return e.emit("ide:panel:open", "git")
}

func (e *IDEEventEmitter) handleOpenAIPanel(_ *IDEAction) error {
	return e.emit("ide:panel:open", "ai")
}

func (e *IDEEventEmitter) handleOpenTerminal(_ *IDEAction) error {
	return e.emit("ide:panel:open", "terminal")
}

func (e *IDEEventEmitter) handleOpenExplorer(_ *IDEAction) error {
	return e.emit("ide:panel:open", "explorer")
}

func (e *IDEEventEmitter) handleOpenProblems(_ *IDEAction) error {
	return e.emit("ide:panel:open", "problems")
}

func (e *IDEEventEmitter) handleClosePanel(panel string) ActionHandler {
	return func(_ *IDEAction) error {
		return e.emit("ide:panel:close", map[string]any{"panel": panel})
	}
}

func (e *IDEEventEmitter) handleMenuAction(actionID string) ActionHandler {
	return func(_ *IDEAction) error {
		return e.emit("ide:menu:action", actionID)
	}
}

func (e *IDEEventEmitter) handleMovePanelSide(from, to string) ActionHandler {
	return func(_ *IDEAction) error {
		return e.emit("ide:panel:move", map[string]any{"from": from, "to": to})
	}
}

func (e *IDEEventEmitter) handleMoveBrowserPreview(position string) ActionHandler {
	return func(_ *IDEAction) error {
		return e.emit("ide:panel:move", map[string]any{"panel": "browser", "position": position})
	}
}

func (e *IDEEventEmitter) handleOpenSearch(_ *IDEAction) error {
	return e.emit("ide:toggle", "search")
}

func (e *IDEEventEmitter) handleOpenRun(_ *IDEAction) error {
	return e.emit("ide:app:run", "run")
}

func (e *IDEEventEmitter) handleOpenDebug(_ *IDEAction) error {
	return e.emit("ide:app:run", "debug")
}

func (e *IDEEventEmitter) handleToggleSidebar(_ *IDEAction) error {
	return e.emit("ide:toggle", "sidebar")
}

func (e *IDEEventEmitter) handleToggleTerminal(_ *IDEAction) error {
	return e.emit("ide:toggle", "terminal")
}

func (e *IDEEventEmitter) handleToggleAI(_ *IDEAction) error {
	return e.emit("ide:toggle", "ai")
}

func (e *IDEEventEmitter) handleSplitVertical(_ *IDEAction) error {
	return e.emit("ide:editor:split", "vertical")
}

func (e *IDEEventEmitter) handleSplitHorizontal(_ *IDEAction) error {
	return e.emit("ide:editor:split", "horizontal")
}

func (e *IDEEventEmitter) handleCloseTab(_ *IDEAction) error {
	return e.emit("ide:editor:close", "current")
}

func (e *IDEEventEmitter) handleCloseAllTabs(_ *IDEAction) error {
	return e.emit("ide:editor:close", "all")
}

func (e *IDEEventEmitter) handleCloseOtherTabs(_ *IDEAction) error {
	return e.emit("ide:editor:close", "others")
}

func (e *IDEEventEmitter) handleFormat(_ *IDEAction) error {
	return e.emit("ide:editor:format")
}

func (e *IDEEventEmitter) handleGoToLine(_ *IDEAction) error {
	return e.emit("ide:editor:goto", "line")
}

func (e *IDEEventEmitter) handleGoToDefinition(_ *IDEAction) error {
	return e.emit("ide:editor:goto", "definition")
}

func (e *IDEEventEmitter) handleToggleWordWrap(_ *IDEAction) error {
	return e.emit("ide:editor:toggle", "wordWrap")
}

func (e *IDEEventEmitter) handleToggleMinimap(_ *IDEAction) error {
	return e.emit("ide:editor:toggle", "minimap")
}

func (e *IDEEventEmitter) handleNewFile(_ *IDEAction) error {
	return e.emit("ide:file:new")
}

func (e *IDEEventEmitter) handleSave(_ *IDEAction) error {
	return e.emit("ide:file:save")
}

func (e *IDEEventEmitter) handleSaveAll(_ *IDEAction) error {
	return e.emit("ide:file:saveAll")
}

func (e *IDEEventEmitter) handleZoomIn(_ *IDEAction) error {
	return e.emit("ide:view:zoom", "in")
}

func (e *IDEEventEmitter) handleZoomOut(_ *IDEAction) error {
	return e.emit("ide:view:zoom", "out")
}

func (e *IDEEventEmitter) handleZoomReset(_ *IDEAction) error {
	return e.emit("ide:view:zoom", "reset")
}

func (e *IDEEventEmitter) handleOpenSettings(_ *IDEAction) error {
	return e.emit("ide:app:settings")
}

func (e *IDEEventEmitter) handleShowKeybindings(_ *IDEAction) error {
	return e.emit("ide:app:keybindings")
}

func (e *IDEEventEmitter) handleReload(_ *IDEAction) error {
	return e.emit("ide:app:reload")
}

func (e *IDEEventEmitter) handleGitStatus(_ *IDEAction) error {
	return e.emit("ide:git:status")
}

func (e *IDEEventEmitter) handleGitCommit(_ *IDEAction) error {
	return e.emit("ide:git:commit")
}

func (e *IDEEventEmitter) handleGitPush(_ *IDEAction) error {
	return e.emit("ide:git:push")
}

func (e *IDEEventEmitter) handleGitPull(_ *IDEAction) error {
	return e.emit("ide:git:pull")
}

func (e *IDEEventEmitter) handlePreviewOpen(_ *IDEAction) error {
	return e.emit("ide:panel:open", "browser")
}

func (e *IDEEventEmitter) handlePreviewFocus(_ *IDEAction) error {
	return e.emit("ide:window:focus", defaultPreviewWindowIDPayload())
}

func (e *IDEEventEmitter) handlePreviewClose(_ *IDEAction) error {
	return e.emit("ide:window:close", defaultPreviewWindowIDPayload())
}
