package main

import (
	"strings"
	"testing"
	"time"
)

func TestWindowLeaseActionIDRoundTrip(t *testing.T) {
	actionID, err := BuildWindowLeaseActionID("detach", WindowLeaseActionPayload{
		SurfaceID:       "preview:preview-browser-default",
		PreviewWindowID: "preview-browser-default",
		Role:            WindowLeaseRolePreview,
		AppletKind:      "browser",
		Title:           "Preview localhost",
		URL:             "http://localhost:5173",
		ReturnTarget: WindowLeaseReturnTarget{
			HostMode: "snapped",
			Position: "right",
		},
		Payload: map[string]any{"url": "http://localhost:5173"},
	})
	if err != nil {
		t.Fatalf("BuildWindowLeaseActionID error = %v", err)
	}

	parsed, err := parseWindowLeaseActionID(actionID)
	if err != nil {
		t.Fatalf("parseWindowLeaseActionID error = %v", err)
	}
	if parsed.kind != "detach" {
		t.Fatalf("kind = %q, want detach", parsed.kind)
	}
	if parsed.surfaceID != "preview:preview-browser-default" {
		t.Fatalf("surfaceID = %q", parsed.surfaceID)
	}
	if parsed.payload.Role != WindowLeaseRolePreview || parsed.payload.AppletKind != "browser" {
		t.Fatalf("payload = %#v, want browser preview", parsed.payload)
	}
	if parsed.payload.Payload["url"] != "http://localhost:5173" {
		t.Fatalf("payload url = %#v", parsed.payload.Payload["url"])
	}
}

func TestWindowLeaseActionIDRejectsSurfaceMismatch(t *testing.T) {
	actionID, err := BuildWindowLeaseActionID("detach", WindowLeaseActionPayload{
		SurfaceID: "preview:one",
		Role:      WindowLeaseRolePreview,
	})
	if err != nil {
		t.Fatalf("BuildWindowLeaseActionID error = %v", err)
	}
	parts := strings.Split(actionID, ":")
	if len(parts) < 3 {
		t.Fatalf("actionID = %q", actionID)
	}
	parts[1] = "preview%3Atwo"
	actionID = strings.Join(parts, ":")

	if _, err := parseWindowLeaseActionID(actionID); err == nil {
		t.Fatal("parseWindowLeaseActionID error = nil, want mismatch error")
	}
}

func TestWindowLeaseRegistrySnapshotTracksDetachedLease(t *testing.T) {
	registry := NewWindowLeaseRegistry()
	registry.clock = func() time.Time {
		return time.UnixMilli(1710000000000)
	}

	record := registry.upsertDetachedLease(WindowLeaseActionPayload{
		SurfaceID:       "preview:browser",
		PreviewWindowID: "browser",
		Role:            WindowLeaseRolePreview,
		AppletKind:      "browser",
		Title:           "Browser",
		URL:             "https://example.test",
		ReturnTarget:    WindowLeaseReturnTarget{HostMode: "snapped", Position: "right"},
	}, "detached:preview:browser")

	if record.Status != WindowLeaseStatusDetached {
		t.Fatalf("record status = %q, want detached", record.Status)
	}
	snapshot := registry.Snapshot(true)
	if !snapshot.DetachedAvailable || !snapshot.SpikeEnabled {
		t.Fatalf("snapshot gate = %#v", snapshot)
	}
	if snapshot.LeasesBySurfaceID["preview:browser"].NativeWindowID != "detached:preview:browser" {
		t.Fatalf("leases = %#v", snapshot.LeasesBySurfaceID)
	}

	returned, ok := registry.markReturned("preview:browser")
	if !ok {
		t.Fatal("markReturned ok = false, want true")
	}
	if returned.Status != WindowLeaseStatusAttached {
		t.Fatalf("returned status = %q, want attached", returned.Status)
	}
}

func TestRunWindowLeaseActionDetachIsGated(t *testing.T) {
	app := &App{windowLeases: NewWindowLeaseRegistry()}
	actionID, err := BuildWindowLeaseActionID("detach", WindowLeaseActionPayload{
		SurfaceID:       "preview:browser",
		PreviewWindowID: "browser",
		Role:            WindowLeaseRolePreview,
		AppletKind:      "browser",
		URL:             "https://example.test",
	})
	if err != nil {
		t.Fatalf("BuildWindowLeaseActionID error = %v", err)
	}

	result, err := app.RunWindowLeaseAction(actionID)
	if err != nil {
		t.Fatalf("RunWindowLeaseAction error = %v", err)
	}
	if result.Handled {
		t.Fatal("Handled = true, want false when env is disabled")
	}
	if result.Snapshot.DetachedAvailable {
		t.Fatal("DetachedAvailable = true, want false when env is disabled")
	}
}

func TestNativeWindowLeaseRoleSupportIncludesHelpers(t *testing.T) {
	for _, role := range []WindowLeaseRole{
		WindowLeaseRolePreview,
		WindowLeaseRoleGitHelper,
		WindowLeaseRoleProblemsHelper,
		WindowLeaseRoleTerminalHelper,
	} {
		if !isNativeWindowLeaseRoleEnabled(role) {
			t.Fatalf("isNativeWindowLeaseRoleEnabled(%q) = false, want true", role)
		}
	}
	if isNativeWindowLeaseRoleEnabled(WindowLeaseRole("")) {
		t.Fatal("isNativeWindowLeaseRoleEnabled(empty) = true, want false")
	}
}

func TestRunWindowLeaseActionDetachNeedsWailsAppForNativePanels(t *testing.T) {
	t.Setenv(envEnableWindowLeaseSpike, "1")
	app := &App{windowLeases: NewWindowLeaseRegistry()}
	actionID, err := BuildWindowLeaseActionID("detach", WindowLeaseActionPayload{
		SurfaceID:  "panel:problems",
		Role:       WindowLeaseRoleProblemsHelper,
		AppletKind: "problems",
		Title:      "Problems",
	})
	if err != nil {
		t.Fatalf("BuildWindowLeaseActionID error = %v", err)
	}

	if _, err := app.RunWindowLeaseAction(actionID); err == nil {
		t.Fatal("RunWindowLeaseAction error = nil, want Wails app initialization error")
	}
}

func TestBuildDetachedPreviewReturnIntentPreservesPreviewState(t *testing.T) {
	record := WindowLeaseRecord{
		SurfaceID:       "preview:browser",
		PreviewWindowID: "browser",
		Role:            WindowLeaseRolePreview,
		AppletKind:      "browser",
		Title:           "Preview localhost",
		URL:             "https://example.test/app",
		Pinned:          true,
		ReturnTarget: WindowLeaseReturnTarget{
			HostMode: "snapped",
			Position: "right",
		},
		Payload: map[string]any{
			"url":       "https://stale.example.test",
			"sessionId": "session-1",
		},
	}

	intent, ok := buildDetachedPreviewReturnIntent(record)
	if !ok {
		t.Fatal("buildDetachedPreviewReturnIntent ok = false, want true")
	}
	if intent["kind"] != "openPreview" || intent["source"] != "window-lease" {
		t.Fatalf("intent = %#v, want window-lease openPreview", intent)
	}
	if intent["surfaceId"] != "preview:browser" {
		t.Fatalf("surfaceId = %#v, want preview:browser", intent["surfaceId"])
	}
	if intent["previewWindowId"] != "browser" {
		t.Fatalf("previewWindowId = %#v, want browser", intent["previewWindowId"])
	}

	preview, ok := intent["preview"].(map[string]any)
	if !ok {
		t.Fatalf("preview = %#v, want map", intent["preview"])
	}
	if preview["id"] != "browser" || preview["surfaceId"] != "preview:browser" {
		t.Fatalf("preview identity = %#v", preview)
	}
	if preview["surface"] != "browser" || preview["title"] != "Preview localhost" {
		t.Fatalf("preview surface/title = %#v", preview)
	}
	if preview["url"] != "https://example.test/app" {
		t.Fatalf("preview url = %#v", preview["url"])
	}
	if preview["mode"] != "snapped" || preview["position"] != "right" {
		t.Fatalf("preview return target = %#v", preview)
	}
	if preview["pinned"] != true {
		t.Fatalf("preview pinned = %#v, want true", preview["pinned"])
	}

	payload, ok := preview["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v, want map", preview["payload"])
	}
	if payload["url"] != "https://example.test/app" {
		t.Fatalf("payload url = %#v, want current record URL", payload["url"])
	}
	if payload["sessionId"] != "session-1" {
		t.Fatalf("payload sessionId = %#v, want session-1", payload["sessionId"])
	}
}

func TestBuildDetachedPreviewReturnIntentSkipsUnsupportedRoles(t *testing.T) {
	if intent, ok := buildDetachedPreviewReturnIntent(WindowLeaseRecord{
		SurfaceID: "panel:git",
		Role:      WindowLeaseRoleGitHelper,
	}); ok || intent != nil {
		t.Fatalf("intent = %#v, ok = %v; want nil, false", intent, ok)
	}
}

func TestBuildWindowLeaseReturnIntentSupportsHelperPanels(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		role      WindowLeaseRole
		surfaceID string
		panelID   string
	}{
		{
			name:      "git",
			role:      WindowLeaseRoleGitHelper,
			surfaceID: "panel:git",
			panelID:   "git",
		},
		{
			name:      "problems",
			role:      WindowLeaseRoleProblemsHelper,
			surfaceID: "panel:problems",
			panelID:   "problems",
		},
		{
			name:      "terminal",
			role:      WindowLeaseRoleTerminalHelper,
			surfaceID: "panel:terminal",
			panelID:   "terminal",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			intent, ok := buildWindowLeaseReturnIntent(WindowLeaseRecord{
				SurfaceID: testCase.surfaceID,
				Role:      testCase.role,
			})
			if !ok {
				t.Fatal("buildWindowLeaseReturnIntent ok = false, want true")
			}
			if intent["kind"] != "focusSurface" || intent["source"] != "window-lease" {
				t.Fatalf("intent = %#v, want window-lease focusSurface", intent)
			}
			if intent["surfaceId"] != testCase.surfaceID {
				t.Fatalf("surfaceId = %#v, want %s", intent["surfaceId"], testCase.surfaceID)
			}
			if intent["panelId"] != testCase.panelID {
				t.Fatalf("panelId = %#v, want %s", intent["panelId"], testCase.panelID)
			}
		})
	}
}
