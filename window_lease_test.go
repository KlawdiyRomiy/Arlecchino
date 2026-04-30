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
