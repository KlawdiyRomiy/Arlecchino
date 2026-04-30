package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	windowLeaseVersion        = 2
	envEnableWindowLeaseSpike = "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE"
	windowLeaseEventName      = "shell:window-lease:status"
)

type WindowLeaseRole string

const (
	WindowLeaseRolePreview        WindowLeaseRole = "preview"
	WindowLeaseRoleGitHelper      WindowLeaseRole = "git-helper"
	WindowLeaseRoleProblemsHelper WindowLeaseRole = "problems-helper"
	WindowLeaseRoleTerminalHelper WindowLeaseRole = "terminal-helper"
)

type WindowLeaseStatus string

const (
	WindowLeaseStatusAttached WindowLeaseStatus = "attached"
	WindowLeaseStatusDetached WindowLeaseStatus = "detached"
	WindowLeaseStatusStale    WindowLeaseStatus = "stale"
	WindowLeaseStatusClosed   WindowLeaseStatus = "closed"
)

type WindowLeaseClosePolicy string

const WindowLeaseCloseReturnToMain WindowLeaseClosePolicy = "return-to-main"

type WindowLeaseReturnTarget struct {
	HostMode string `json:"hostMode,omitempty"`
	Position string `json:"position,omitempty"`
}

type WindowLeaseActionPayload struct {
	SurfaceID       string                  `json:"surfaceId"`
	PreviewWindowID string                  `json:"previewWindowId,omitempty"`
	Role            WindowLeaseRole         `json:"role"`
	AppletKind      string                  `json:"appletKind,omitempty"`
	Title           string                  `json:"title,omitempty"`
	URL             string                  `json:"url,omitempty"`
	Pinned          bool                    `json:"pinned,omitempty"`
	ReturnTarget    WindowLeaseReturnTarget `json:"returnTarget,omitempty"`
	Payload         map[string]any          `json:"payload,omitempty"`
}

type WindowLeaseRecord struct {
	ID              string                  `json:"id"`
	SurfaceID       string                  `json:"surfaceId"`
	PreviewWindowID string                  `json:"previewWindowId,omitempty"`
	Role            WindowLeaseRole         `json:"role"`
	AppletKind      string                  `json:"appletKind,omitempty"`
	NativeWindowID  string                  `json:"nativeWindowId,omitempty"`
	Status          WindowLeaseStatus       `json:"status"`
	ClosePolicy     WindowLeaseClosePolicy  `json:"closePolicy"`
	ReturnTarget    WindowLeaseReturnTarget `json:"returnTarget,omitempty"`
	Title           string                  `json:"title,omitempty"`
	URL             string                  `json:"url,omitempty"`
	Pinned          bool                    `json:"pinned,omitempty"`
	Payload         map[string]any          `json:"payload,omitempty"`
	UpdatedAt       int64                   `json:"updatedAt"`
}

type WindowLeaseSnapshot struct {
	Version             int                          `json:"version"`
	Runtime             string                       `json:"runtime"`
	Platform            string                       `json:"platform"`
	SpikeEnabled        bool                         `json:"spikeEnabled"`
	DetachedAvailable   bool                         `json:"detachedAvailable"`
	SupportedRoles      []WindowLeaseRole            `json:"supportedRoles"`
	SupportedSurfaceIDs []string                     `json:"supportedSurfaceIds,omitempty"`
	Leases              []WindowLeaseRecord          `json:"leases"`
	LeasesBySurfaceID   map[string]WindowLeaseRecord `json:"leasesBySurfaceId"`
	Reason              string                       `json:"reason,omitempty"`
}

type WindowLeaseActionResult struct {
	Handled   bool                `json:"handled"`
	ActionID  string              `json:"actionId"`
	Kind      string              `json:"kind,omitempty"`
	SurfaceID string              `json:"surfaceId,omitempty"`
	Record    *WindowLeaseRecord  `json:"record,omitempty"`
	Snapshot  WindowLeaseSnapshot `json:"snapshot"`
	Message   string              `json:"message,omitempty"`
}

type WindowLeaseRegistry struct {
	mu      sync.RWMutex
	leases  map[string]WindowLeaseRecord
	windows map[string]*application.WebviewWindow
	clock   func() time.Time
}

func NewWindowLeaseRegistry() *WindowLeaseRegistry {
	return &WindowLeaseRegistry{
		leases:  make(map[string]WindowLeaseRecord),
		windows: make(map[string]*application.WebviewWindow),
		clock:   time.Now,
	}
}

type parsedWindowLeaseAction struct {
	kind      string
	surfaceID string
	payload   WindowLeaseActionPayload
}

func BuildWindowLeaseActionID(kind string, payload WindowLeaseActionPayload) (string, error) {
	kind = normalizeWindowLeaseActionKind(kind)
	if kind == "" {
		return "", fmt.Errorf("window lease action kind is empty")
	}
	payload.SurfaceID = strings.TrimSpace(payload.SurfaceID)
	if payload.SurfaceID == "" {
		return "", fmt.Errorf("window lease surface id is empty")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(data)
	return fmt.Sprintf("windowLease.%s:%s:%s", kind, url.QueryEscape(payload.SurfaceID), encoded), nil
}

func parseWindowLeaseActionID(actionID string) (parsedWindowLeaseAction, error) {
	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		return parsedWindowLeaseAction{}, fmt.Errorf("window lease action id is empty")
	}
	actionID = strings.TrimPrefix(actionID, "windowLease.")

	parts := strings.SplitN(actionID, ":", 3)
	if len(parts) < 2 {
		return parsedWindowLeaseAction{}, fmt.Errorf("invalid window lease action id: %s", actionID)
	}

	kind := normalizeWindowLeaseActionKind(parts[0])
	if kind == "" {
		return parsedWindowLeaseAction{}, fmt.Errorf("unsupported window lease action kind: %s", parts[0])
	}
	surfaceID, err := url.QueryUnescape(parts[1])
	if err != nil {
		return parsedWindowLeaseAction{}, err
	}
	surfaceID = strings.TrimSpace(surfaceID)
	if surfaceID == "" {
		return parsedWindowLeaseAction{}, fmt.Errorf("window lease surface id is empty")
	}

	payload := WindowLeaseActionPayload{SurfaceID: surfaceID}
	if len(parts) == 3 && strings.TrimSpace(parts[2]) != "" {
		data, err := base64.RawURLEncoding.DecodeString(parts[2])
		if err != nil {
			return parsedWindowLeaseAction{}, fmt.Errorf("invalid window lease payload: %w", err)
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			return parsedWindowLeaseAction{}, fmt.Errorf("invalid window lease payload json: %w", err)
		}
		if strings.TrimSpace(payload.SurfaceID) == "" {
			payload.SurfaceID = surfaceID
		}
	}
	payload.SurfaceID = strings.TrimSpace(payload.SurfaceID)
	if payload.SurfaceID != surfaceID {
		return parsedWindowLeaseAction{}, fmt.Errorf("window lease surface id mismatch")
	}
	payload = normalizeWindowLeaseActionPayload(payload)
	return parsedWindowLeaseAction{kind: kind, surfaceID: surfaceID, payload: payload}, nil
}

func normalizeWindowLeaseActionKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "detach":
		return "detach"
	case "focus", "focus-window":
		return "focus-window"
	case "return", "return-to-main":
		return "return-to-main"
	case "close", "close-window":
		return "close-window"
	default:
		return ""
	}
}

func normalizeWindowLeaseActionPayload(payload WindowLeaseActionPayload) WindowLeaseActionPayload {
	payload.SurfaceID = strings.TrimSpace(payload.SurfaceID)
	payload.PreviewWindowID = strings.TrimSpace(payload.PreviewWindowID)
	payload.AppletKind = strings.TrimSpace(payload.AppletKind)
	payload.Title = strings.TrimSpace(payload.Title)
	payload.URL = strings.TrimSpace(payload.URL)
	payload.ReturnTarget.HostMode = strings.TrimSpace(payload.ReturnTarget.HostMode)
	payload.ReturnTarget.Position = strings.TrimSpace(payload.ReturnTarget.Position)
	if payload.Role == "" {
		payload.Role = inferWindowLeaseRole(payload.SurfaceID)
	}
	if payload.AppletKind == "" && payload.Role == WindowLeaseRolePreview {
		payload.AppletKind = "browser"
	}
	if payload.Title == "" {
		payload.Title = payload.SurfaceID
	}
	if payload.Payload == nil {
		payload.Payload = map[string]any{}
	}
	if payload.URL != "" {
		payload.Payload["url"] = payload.URL
	}
	return payload
}

func inferWindowLeaseRole(surfaceID string) WindowLeaseRole {
	if strings.HasPrefix(surfaceID, "preview:") {
		return WindowLeaseRolePreview
	}
	switch strings.TrimPrefix(surfaceID, "panel:") {
	case "git":
		return WindowLeaseRoleGitHelper
	case "problems":
		return WindowLeaseRoleProblemsHelper
	case "terminal":
		return WindowLeaseRoleTerminalHelper
	default:
		return ""
	}
}

func isNativeWindowLeaseRoleEnabled(role WindowLeaseRole) bool {
	return role == WindowLeaseRolePreview
}

func (r *WindowLeaseRegistry) Snapshot(spikeEnabled bool) WindowLeaseSnapshot {
	if r == nil {
		return emptyWindowLeaseSnapshot(spikeEnabled)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.snapshotLocked(spikeEnabled)
}

func emptyWindowLeaseSnapshot(spikeEnabled bool) WindowLeaseSnapshot {
	reason := "Detached windows require ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1."
	if spikeEnabled {
		reason = "Window Lease spike is enabled for preview detached windows."
	}
	return WindowLeaseSnapshot{
		Version:           windowLeaseVersion,
		Runtime:           "wails-v3",
		Platform:          runtime.GOOS,
		SpikeEnabled:      spikeEnabled,
		DetachedAvailable: spikeEnabled,
		SupportedRoles: []WindowLeaseRole{
			WindowLeaseRolePreview,
		},
		Leases:            []WindowLeaseRecord{},
		LeasesBySurfaceID: map[string]WindowLeaseRecord{},
		Reason:            reason,
	}
}

func (r *WindowLeaseRegistry) snapshotLocked(spikeEnabled bool) WindowLeaseSnapshot {
	snapshot := emptyWindowLeaseSnapshot(spikeEnabled)
	snapshot.Leases = make([]WindowLeaseRecord, 0, len(r.leases))
	snapshot.LeasesBySurfaceID = make(map[string]WindowLeaseRecord, len(r.leases))
	for _, lease := range r.leases {
		cloned := cloneWindowLeaseRecord(lease)
		snapshot.Leases = append(snapshot.Leases, cloned)
		snapshot.LeasesBySurfaceID[cloned.SurfaceID] = cloned
		if cloned.Status == WindowLeaseStatusDetached {
			snapshot.SupportedSurfaceIDs = append(snapshot.SupportedSurfaceIDs, cloned.SurfaceID)
		}
	}
	return snapshot
}

func (r *WindowLeaseRegistry) upsertDetachedLease(payload WindowLeaseActionPayload, nativeWindowID string) WindowLeaseRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.nowMsLocked()
	record := WindowLeaseRecord{
		ID:              "lease:" + payload.SurfaceID,
		SurfaceID:       payload.SurfaceID,
		PreviewWindowID: payload.PreviewWindowID,
		Role:            payload.Role,
		AppletKind:      payload.AppletKind,
		NativeWindowID:  strings.TrimSpace(nativeWindowID),
		Status:          WindowLeaseStatusDetached,
		ClosePolicy:     WindowLeaseCloseReturnToMain,
		ReturnTarget:    payload.ReturnTarget,
		Title:           payload.Title,
		URL:             payload.URL,
		Pinned:          payload.Pinned,
		Payload:         cloneWindowLeasePayload(payload.Payload),
		UpdatedAt:       now,
	}
	r.leases[payload.SurfaceID] = record
	return cloneWindowLeaseRecord(record)
}

func (r *WindowLeaseRegistry) attachWindow(surfaceID string, window *application.WebviewWindow) {
	if r == nil || window == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.windows[surfaceID] = window
}

func (r *WindowLeaseRegistry) markReturned(surfaceID string) (WindowLeaseRecord, bool) {
	if r == nil {
		return WindowLeaseRecord{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.leases[surfaceID]
	if !ok {
		return WindowLeaseRecord{}, false
	}
	delete(r.windows, surfaceID)
	record.Status = WindowLeaseStatusAttached
	record.UpdatedAt = r.nowMsLocked()
	r.leases[surfaceID] = record
	return cloneWindowLeaseRecord(record), true
}

func (r *WindowLeaseRegistry) closeWindow(surfaceID string) bool {
	if r == nil {
		return false
	}
	r.mu.RLock()
	window := r.windows[surfaceID]
	r.mu.RUnlock()
	if window == nil {
		return false
	}
	window.Close()
	return true
}

func (r *WindowLeaseRegistry) focusWindow(surfaceID string) bool {
	if r == nil {
		return false
	}
	r.mu.RLock()
	window := r.windows[surfaceID]
	r.mu.RUnlock()
	if window == nil {
		return false
	}
	window.Restore()
	window.Focus()
	return true
}

func (r *WindowLeaseRegistry) nowMsLocked() int64 {
	clock := r.clock
	if clock == nil {
		clock = time.Now
	}
	return clock().UnixMilli()
}

func cloneWindowLeaseRecord(record WindowLeaseRecord) WindowLeaseRecord {
	record.Payload = cloneWindowLeasePayload(record.Payload)
	return record
}

func cloneWindowLeasePayload(payload map[string]any) map[string]any {
	if payload == nil {
		return nil
	}
	clone := make(map[string]any, len(payload))
	for key, value := range payload {
		switch typed := value.(type) {
		case string, float64, float32, int, int64, bool, nil:
			clone[key] = typed
		default:
			clone[key] = fmt.Sprint(typed)
		}
	}
	return clone
}

func (a *App) GetWindowLeaseStatus() WindowLeaseSnapshot {
	spikeEnabled := envFlagEnabled(envEnableWindowLeaseSpike)
	if a == nil || a.windowLeases == nil {
		return emptyWindowLeaseSnapshot(spikeEnabled)
	}
	return a.windowLeases.Snapshot(spikeEnabled)
}

func (a *App) RunWindowLeaseAction(actionID string) (WindowLeaseActionResult, error) {
	parsed, err := parseWindowLeaseActionID(actionID)
	if err != nil {
		return WindowLeaseActionResult{}, err
	}
	if a == nil || a.windowLeases == nil {
		return WindowLeaseActionResult{}, fmt.Errorf("window lease registry is unavailable")
	}

	switch parsed.kind {
	case "detach":
		return a.runWindowLeaseDetach(actionID, parsed)
	case "focus-window":
		handled := a.windowLeases.focusWindow(parsed.surfaceID)
		result := WindowLeaseActionResult{
			Handled:   handled,
			ActionID:  actionID,
			Kind:      parsed.kind,
			SurfaceID: parsed.surfaceID,
			Snapshot:  a.GetWindowLeaseStatus(),
			Message:   "Detached window focus requested.",
		}
		if !handled {
			result.Message = "Detached window is not active."
		}
		return result, nil
	case "return-to-main", "close-window":
		handled := a.windowLeases.closeWindow(parsed.surfaceID)
		result := WindowLeaseActionResult{
			Handled:   handled,
			ActionID:  actionID,
			Kind:      parsed.kind,
			SurfaceID: parsed.surfaceID,
			Snapshot:  a.GetWindowLeaseStatus(),
			Message:   "Detached window close requested.",
		}
		if !handled {
			result.Message = "Detached window is not active."
		}
		return result, nil
	default:
		return WindowLeaseActionResult{}, fmt.Errorf("unsupported window lease action: %s", parsed.kind)
	}
}

func (a *App) runWindowLeaseDetach(actionID string, parsed parsedWindowLeaseAction) (WindowLeaseActionResult, error) {
	spikeEnabled := envFlagEnabled(envEnableWindowLeaseSpike)
	result := WindowLeaseActionResult{
		Handled:   false,
		ActionID:  actionID,
		Kind:      parsed.kind,
		SurfaceID: parsed.surfaceID,
		Snapshot:  a.GetWindowLeaseStatus(),
	}
	if !spikeEnabled {
		result.Message = "Detached windows require ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1."
		return result, nil
	}
	if !isNativeWindowLeaseRoleEnabled(parsed.payload.Role) {
		result.Message = "Native detached window spike currently supports Browser Preview only."
		return result, nil
	}
	if parsed.payload.AppletKind != "" && parsed.payload.AppletKind != "browser" {
		result.Message = "Native detached preview spike currently supports browser previews only."
		return result, nil
	}
	if a.wailsApp == nil {
		return result, fmt.Errorf("wails application is not initialized")
	}

	record := a.windowLeases.upsertDetachedLease(parsed.payload, "")
	windowURL, err := buildDetachedWindowURL(record)
	if err != nil {
		return result, err
	}
	nativeWindowID := "detached:" + parsed.surfaceID
	window := a.wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               nativeWindowID,
		Title:              record.Title,
		Width:              980,
		Height:             720,
		MinWidth:           520,
		MinHeight:          360,
		URL:                windowURL,
		UseApplicationMenu: true,
		BackgroundType:     application.BackgroundTypeTransparent,
		BackgroundColour:   application.NewRGBA(10, 10, 10, 0),
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarDefault,
			InvisibleTitleBarHeight: 0,
			Backdrop:                application.MacBackdropTransparent,
		},
		Windows: application.WindowsWindow{
			DisableIcon: false,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	})
	record = a.windowLeases.upsertDetachedLease(parsed.payload, nativeWindowID)
	a.windowLeases.attachWindow(parsed.surfaceID, window)
	window.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		a.handleDetachedWindowClosing(parsed.surfaceID)
	})
	window.Show()
	window.Focus()

	a.emitWindowLeaseStatus()
	result.Handled = true
	result.Record = &record
	result.Snapshot = a.GetWindowLeaseStatus()
	result.Message = "Detached Wails window created."
	return result, nil
}

func buildDetachedWindowURL(record WindowLeaseRecord) (string, error) {
	payload := map[string]any{
		"surfaceId":       record.SurfaceID,
		"previewWindowId": record.PreviewWindowID,
		"role":            record.Role,
		"appletKind":      record.AppletKind,
		"title":           record.Title,
		"pinned":          record.Pinned,
		"returnTarget":    record.ReturnTarget,
		"payload":         record.Payload,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	values := url.Values{}
	values.Set("arleDetachedHost", base64.RawURLEncoding.EncodeToString(data))
	return "/?" + values.Encode(), nil
}

func (a *App) handleDetachedWindowClosing(surfaceID string) {
	if a == nil || a.windowLeases == nil {
		return
	}
	record, ok := a.windowLeases.markReturned(surfaceID)
	if !ok {
		return
	}
	a.emitWindowLeaseStatus()
	if intent, ok := buildDetachedPreviewReturnIntent(record); ok {
		a.focusMainWindow()
		a.dispatchOpenIntent(intent)
	}
}

func buildDetachedPreviewReturnIntent(record WindowLeaseRecord) (map[string]any, bool) {
	if record.Role != WindowLeaseRolePreview {
		return nil, false
	}

	payload := cloneWindowLeasePayload(record.Payload)
	if payload == nil {
		payload = map[string]any{}
	}
	if record.URL != "" {
		payload["url"] = record.URL
	}

	return map[string]any{
		"kind":            "openPreview",
		"source":          "window-lease",
		"surfaceId":       record.SurfaceID,
		"previewWindowId": record.PreviewWindowID,
		"preview": map[string]any{
			"id":        record.PreviewWindowID,
			"surfaceId": record.SurfaceID,
			"surface":   record.AppletKind,
			"title":     record.Title,
			"url":       record.URL,
			"payload":   payload,
			"mode":      record.ReturnTarget.HostMode,
			"position":  record.ReturnTarget.Position,
			"pinned":    record.Pinned,
		},
	}, true
}

func (a *App) emitWindowLeaseStatus() {
	if a == nil {
		return
	}
	a.emitEvent(windowLeaseEventName, a.GetWindowLeaseStatus())
}
