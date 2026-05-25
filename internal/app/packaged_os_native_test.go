package app

import "testing"

func TestPackagedOSNativeDeliveryReady_RequiresPackagedBuildAndAdapter(t *testing.T) {
	if packagedOSNativeDeliveryReady(PackagedOSIntegrationOptions{
		PackagedBuild:     true,
		NativeTrayEnabled: true,
	}) {
		t.Fatal("delivery ready with tray only without spike = true, want false")
	}
	if packagedOSNativeDeliveryReady(PackagedOSIntegrationOptions{
		NativeNotificationsEnabled: true,
	}) {
		t.Fatal("delivery ready without packaged build = true, want false")
	}
	if packagedOSNativeDeliveryReady(PackagedOSIntegrationOptions{
		PackagedBuild: true,
		SpikeEnabled:  true,
	}) {
		t.Fatal("delivery ready without explicit native adapter = true, want false")
	}
	if !packagedOSNativeDeliveryReady(PackagedOSIntegrationOptions{
		PackagedBuild:              true,
		NativeNotificationsEnabled: true,
	}) {
		t.Fatal("delivery ready with packaged notifications = false, want true")
	}
	if !packagedOSNativeDeliveryReady(PackagedOSIntegrationOptions{
		PackagedBuild:     true,
		DockBadgesEnabled: true,
	}) {
		t.Fatal("delivery ready with packaged dock badges = false, want true")
	}
}

func TestBuildPackagedOSNativeTrayModel_ExposesOnlyBackgroundActions(t *testing.T) {
	model := buildPackagedOSNativeTrayModel(BackgroundShellStatusSnapshot{
		ActiveCount:    2,
		AttentionCount: 1,
		Actions: []BackgroundShellAction{
			{
				ID:      "cancel:indexer",
				Label:   "Cancel indexing",
				Intent:  "cancel-job",
				Enabled: true,
			},
			{
				ID:      "   ",
				Label:   "Broken",
				Intent:  "cancel-job",
				Enabled: true,
			},
			{
				ID:      "focus:panel:problems",
				Label:   "Focus Problems",
				Intent:  "focus-surface",
				Enabled: false,
			},
		},
	})

	if model.Title != "Arlecchino Background" {
		t.Fatalf("Title = %q", model.Title)
	}
	if model.ActiveCount != 2 || model.AttentionCount != 1 {
		t.Fatalf("counts = %d/%d, want 2/1", model.ActiveCount, model.AttentionCount)
	}
	if len(model.Actions) != 2 {
		t.Fatalf("actions = %d, want 2", len(model.Actions))
	}
	if model.Actions[0].ID != "cancel:indexer" || !model.Actions[0].Enabled {
		t.Fatalf("first action = %#v", model.Actions[0])
	}
	if model.Actions[1].ID != "focus:panel:problems" || model.Actions[1].Enabled {
		t.Fatalf("second action = %#v", model.Actions[1])
	}
}

func TestSelectPackagedOSNativeNotificationCandidates_DedupesByDedupeKey(t *testing.T) {
	snapshot := BackgroundShellStatusSnapshot{
		NotificationCandidates: []BackgroundShellNotificationCandidate{
			{
				ID:        "notification:indexer:1",
				JobID:     "indexer",
				Title:     "Indexer",
				Body:      "Failed",
				DedupeKey: "indexer:failed",
			},
			{
				ID:    "notification:lsp:1",
				JobID: "lsp",
				Title: "LSP",
				Body:  "Installed",
			},
		},
	}

	now := int64(60_000)
	pending := selectPackagedOSNativeNotificationCandidates(snapshot, map[string]int64{
		"indexer:failed": now,
	}, now)
	if len(pending) != 1 {
		t.Fatalf("pending = %d, want 1", len(pending))
	}
	if pending[0].ID != "notification:lsp:1" {
		t.Fatalf("pending[0].ID = %q", pending[0].ID)
	}

	pending = selectPackagedOSNativeNotificationCandidates(snapshot, map[string]int64{
		"indexer:failed":       now,
		"notification:lsp:1":   now,
		"notification:missing": now,
	}, now)
	if len(pending) != 0 {
		t.Fatalf("pending = %d, want 0", len(pending))
	}

	pending = selectPackagedOSNativeNotificationCandidates(snapshot, map[string]int64{
		"indexer:failed": now - packagedOSNativeNotificationCooldownMs - 1,
	}, now)
	if len(pending) != 2 {
		t.Fatalf("pending = %d, want 2 after TTL expiry", len(pending))
	}
}

func TestPackagedOSNativeDockBadgeLabel_UsesAttentionCount(t *testing.T) {
	if label := packagedOSNativeDockBadgeLabel(BackgroundShellStatusSnapshot{}); label != "" {
		t.Fatalf("label = %q, want empty", label)
	}
	if label := packagedOSNativeDockBadgeLabel(BackgroundShellStatusSnapshot{AttentionCount: 3}); label != "3" {
		t.Fatalf("label = %q, want 3", label)
	}
}

func TestNativeNotificationPayloadCarriesActionTokenOnly(t *testing.T) {
	payload := nativeNotificationPayload(BackgroundShellNotificationCandidate{
		ID:       "notification:terminal:input",
		JobID:    "terminal:input",
		Severity: BackgroundShellSeverityWarning,
		Title:    "Terminal task needs input",
		Body:     "A command is waiting for stdin.",
		Action: &BackgroundShellAction{
			ID:             "focus:panel:terminal",
			Intent:         "focus-surface",
			JobID:          "terminal:input",
			OwnerSurfaceID: "panel:terminal",
			Enabled:        true,
		},
	}, "terminal:input:blocked")

	if _, ok := payload["backgroundActionId"]; ok {
		t.Fatalf("native payload leaked routing field at top level: %#v", payload)
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		t.Fatalf("payload data = %#v, want map", payload["data"])
	}
	if data["backgroundActionId"] != "focus:panel:terminal" || data["surfaceId"] != "panel:terminal" {
		t.Fatalf("routing data = %#v, want action and surface", data)
	}
	if _, ok := data["openIntent"]; ok {
		t.Fatalf("payload leaked nested openIntent: %#v", data["openIntent"])
	}
}

func TestPackagedOSNativeDeliveryRecordsSwiftNotificationCallbacks(t *testing.T) {
	delivery := NewPackagedOSNativeDelivery(PackagedOSIntegrationOptions{})

	delivery.mu.Lock()
	delivery.sentNotificationKeys["indexer:failed"] = 100
	delivery.pendingNotificationKeys["notification:indexer:1"] = "indexer:failed"
	delivery.notificationDeliveryResult = "pending"
	delivery.mu.Unlock()

	delivery.recordNativeNotificationDelivered("notification:indexer:1")

	delivery.mu.Lock()
	if delivery.sentNotificationCount != 1 {
		t.Fatalf("sentNotificationCount = %d, want 1", delivery.sentNotificationCount)
	}
	if delivery.notificationDeliveryResult != "delivered" || !delivery.notificationReady {
		t.Fatalf("delivery state = %q/%v, want delivered ready", delivery.notificationDeliveryResult, delivery.notificationReady)
	}
	if delivery.notificationPermissionStatus != "granted" {
		t.Fatalf("notificationPermissionStatus = %q, want granted", delivery.notificationPermissionStatus)
	}
	if _, ok := delivery.pendingNotificationKeys["notification:indexer:1"]; ok {
		t.Fatalf("pending key was not cleared")
	}
	delivery.mu.Unlock()

	delivery.recordNativeNotificationDelivered("notification:indexer:1")
	delivery.mu.Lock()
	if delivery.sentNotificationCount != 1 {
		t.Fatalf("duplicate delivered callback changed sentNotificationCount = %d", delivery.sentNotificationCount)
	}
	delivery.mu.Unlock()
}

func TestPackagedOSNativeDeliveryRecordsSwiftNotificationDenied(t *testing.T) {
	delivery := NewPackagedOSNativeDelivery(PackagedOSIntegrationOptions{})

	delivery.mu.Lock()
	delivery.sentNotificationKeys["indexer:failed"] = 100
	delivery.pendingNotificationKeys["notification:indexer:1"] = "indexer:failed"
	delivery.notificationDeliveryResult = "pending"
	delivery.mu.Unlock()

	delivery.recordNativeNotificationFailure("notification:indexer:1", "denied")

	status := packagedOSNativeDeliveryLiveStatus(
		delivery,
		PackagedOSIntegrationOptions{
			PackagedBuild:              true,
			NativeNotificationsEnabled: true,
		},
		emptyBackgroundShellStatusSnapshot(),
	)

	if status.NotificationDeliveryResult != "failed" || status.NotificationPermissionStatus != "denied" {
		t.Fatalf("status = %#v, want failed denied", status)
	}
	if !stringSliceContains(status.FailureStates, "no-permission") {
		t.Fatalf("FailureStates = %#v, want no-permission", status.FailureStates)
	}
	delivery.mu.Lock()
	if _, ok := delivery.sentNotificationKeys["indexer:failed"]; ok {
		t.Fatalf("failed native notification kept dedupe key")
	}
	delivery.mu.Unlock()
}

func TestPackagedOSNativeDeliveryDecorate_ReportsActualNativeState(t *testing.T) {
	delivery := NewPackagedOSNativeDelivery(PackagedOSIntegrationOptions{})
	delivery.trayReady = true
	delivery.sentNotificationCount = 2

	snapshot := delivery.Decorate(emptyBackgroundShellStatusSnapshot())
	if !snapshot.NativeTrayEnabled {
		t.Fatal("NativeTrayEnabled = false, want true")
	}
	if !snapshot.NativeNotificationsSent {
		t.Fatal("NativeNotificationsSent = false, want true")
	}
}

func TestPackagedOSNativeFailureStates_AreClassified(t *testing.T) {
	delivery := NewPackagedOSNativeDelivery(PackagedOSIntegrationOptions{})
	delivery.recordNotificationPermission("denied", true)
	delivery.recordNotificationDeliveryAttempt("failed")
	delivery.setLastError("native notification authorization was not granted")
	delivery.setLastError("dock badge update failed: denied")
	delivery.recordFailureState("action-rejected")

	status := packagedOSNativeDeliveryLiveStatus(
		delivery,
		PackagedOSIntegrationOptions{
			PackagedBuild:              true,
			NativeNotificationsEnabled: true,
		},
		emptyBackgroundShellStatusSnapshot(),
	)

	if !status.Enabled || !status.NotificationsEnabled {
		t.Fatalf("status = %#v, want enabled notification status", status)
	}
	if !status.NotificationPermissionRequested || status.NotificationPermissionStatus != "denied" {
		t.Fatalf("notification permission = %v/%q, want requested denied", status.NotificationPermissionRequested, status.NotificationPermissionStatus)
	}
	if !status.NotificationDeliveryAttempted || status.NotificationDeliveryResult != "failed" {
		t.Fatalf("notification delivery = %v/%q, want attempted failed", status.NotificationDeliveryAttempted, status.NotificationDeliveryResult)
	}
	if !stringSliceContains(status.FailureStates, "no-permission") {
		t.Fatalf("FailureStates = %#v, want no-permission", status.FailureStates)
	}
	if !stringSliceContains(status.FailureStates, "delivery-failed") {
		t.Fatalf("FailureStates = %#v, want delivery-failed", status.FailureStates)
	}
	if !stringSliceContains(status.FailureStates, "action-rejected") {
		t.Fatalf("FailureStates = %#v, want action-rejected", status.FailureStates)
	}
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
