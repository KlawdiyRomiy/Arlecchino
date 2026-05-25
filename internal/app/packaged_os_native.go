package app

import (
	"context"
	"fmt"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/icons"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type PackagedOSNativeTrayAction struct {
	ID      string
	Label   string
	Enabled bool
}

type PackagedOSNativeTrayModel struct {
	Title          string
	StatusLabel    string
	EmptyLabel     string
	Actions        []PackagedOSNativeTrayAction
	ActiveCount    int
	AttentionCount int
}

const packagedOSNativeNotificationCooldownMs = int64((30 * time.Second) / time.Millisecond)

type PackagedOSNativeDelivery struct {
	mu sync.Mutex

	options PackagedOSIntegrationOptions

	tray      *application.SystemTray
	trayReady bool

	notificationService             *notifications.NotificationService
	notificationStartupAttempted    bool
	notificationReady               bool
	notificationPermissionRequested bool
	notificationPermissionStatus    string
	notificationDeliveryAttempted   bool
	notificationDeliveryResult      string
	sentNotificationKeys            map[string]int64
	pendingNotificationKeys         map[string]string
	sentNotificationCount           int

	dockService          *dock.DockService
	dockStartupAttempted bool
	dockReady            bool
	lastDockBadge        string

	lastAttentionRevision uint64

	lastError string
	failures  map[string]struct{}
}

func NewPackagedOSNativeDelivery(options PackagedOSIntegrationOptions) *PackagedOSNativeDelivery {
	return &PackagedOSNativeDelivery{
		options:                 options,
		sentNotificationKeys:    make(map[string]int64),
		pendingNotificationKeys: make(map[string]string),
		failures:                make(map[string]struct{}),
	}
}

func (d *PackagedOSNativeDelivery) LastError() string {
	if d == nil {
		return ""
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.lastError
}

func (d *PackagedOSNativeDelivery) failureStatesLocked() []string {
	states := make([]string, 0, len(d.failures))
	for state := range d.failures {
		states = append(states, state)
	}
	sort.Strings(states)
	return states
}

func packagedOSNativeDeliveryReady(options PackagedOSIntegrationOptions) bool {
	if !options.PackagedBuild {
		return false
	}
	return packagedOSNativeTrayReady(options) ||
		packagedOSNativeNotificationsReady(options) ||
		packagedOSNativeDockBadgesReady(options)
}

func packagedOSNativeTrayReady(options PackagedOSIntegrationOptions) bool {
	return options.PackagedBuild && options.SpikeEnabled && options.NativeTrayEnabled
}

func packagedOSNativeNotificationsReady(options PackagedOSIntegrationOptions) bool {
	return options.PackagedBuild && options.NativeNotificationsEnabled
}

func packagedOSNativeDockBadgesReady(options PackagedOSIntegrationOptions) bool {
	return options.PackagedBuild && options.DockBadgesEnabled
}

func buildPackagedOSNativeTrayModel(snapshot BackgroundShellStatusSnapshot) PackagedOSNativeTrayModel {
	actions := make([]PackagedOSNativeTrayAction, 0, len(snapshot.Actions))
	for _, action := range snapshot.Actions {
		id := strings.TrimSpace(action.ID)
		label := strings.TrimSpace(action.Label)
		if id == "" || label == "" {
			continue
		}
		actions = append(actions, PackagedOSNativeTrayAction{
			ID:      id,
			Label:   label,
			Enabled: action.Enabled,
		})
	}

	return PackagedOSNativeTrayModel{
		Title:          "Arlecchino Background",
		StatusLabel:    fmt.Sprintf("Active %d, Attention %d", snapshot.ActiveCount, snapshot.AttentionCount),
		EmptyLabel:     "No background actions",
		Actions:        actions,
		ActiveCount:    snapshot.ActiveCount,
		AttentionCount: snapshot.AttentionCount,
	}
}

func selectPackagedOSNativeNotificationCandidates(
	snapshot BackgroundShellStatusSnapshot,
	sent map[string]int64,
	now int64,
) []BackgroundShellNotificationCandidate {
	if len(snapshot.NotificationCandidates) == 0 {
		return nil
	}
	if sent == nil {
		sent = map[string]int64{}
	}

	result := make([]BackgroundShellNotificationCandidate, 0, len(snapshot.NotificationCandidates))
	for _, candidate := range snapshot.NotificationCandidates {
		key := packagedOSNativeNotificationKey(candidate)
		if key == "" {
			continue
		}
		if sentAt, ok := sent[key]; ok {
			if now <= 0 || now-sentAt < packagedOSNativeNotificationCooldownMs {
				continue
			}
		}
		result = append(result, cloneBackgroundShellNotificationCandidate(candidate))
	}
	return result
}

func packagedOSNativeNotificationKey(candidate BackgroundShellNotificationCandidate) string {
	if key := strings.TrimSpace(candidate.DedupeKey); key != "" {
		return key
	}
	return strings.TrimSpace(candidate.ID)
}

func packagedOSNativeDockBadgeLabel(snapshot BackgroundShellStatusSnapshot) string {
	if snapshot.AttentionCount <= 0 {
		return ""
	}
	return strconv.Itoa(snapshot.AttentionCount)
}

func (a *App) configurePackagedOSNativeDelivery() {
	if a == nil || a.packagedOSNative == nil {
		return
	}

	a.packagedOSNative.Configure(a)
}

func (a *App) decorateBackgroundShellStatusSnapshot(snapshot BackgroundShellStatusSnapshot) BackgroundShellStatusSnapshot {
	if a == nil || a.packagedOSNative == nil {
		return snapshot
	}
	return a.packagedOSNative.Decorate(snapshot)
}

func (a *App) applyPackagedOSNativeDelivery(snapshot BackgroundShellStatusSnapshot) BackgroundShellStatusSnapshot {
	if a == nil || a.packagedOSNative == nil {
		return snapshot
	}
	return a.packagedOSNative.Apply(a.ctx, a, snapshot)
}

func (d *PackagedOSNativeDelivery) Configure(owner *App) {
	if d == nil || owner == nil || owner.wailsApp == nil || !packagedOSNativeDeliveryReady(d.options) {
		return
	}

	if packagedOSNativeTrayReady(d.options) {
		d.ensureTray(owner, emptyBackgroundShellStatusSnapshot())
	}
}

func (d *PackagedOSNativeDelivery) Decorate(snapshot BackgroundShellStatusSnapshot) BackgroundShellStatusSnapshot {
	if d == nil {
		return snapshot
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	snapshot.NativeTrayEnabled = d.trayReady
	snapshot.NativeNotificationsSent = d.sentNotificationCount > 0
	return snapshot
}

func (d *PackagedOSNativeDelivery) Apply(
	ctx context.Context,
	owner *App,
	snapshot BackgroundShellStatusSnapshot,
) BackgroundShellStatusSnapshot {
	if d == nil || owner == nil || !packagedOSNativeDeliveryReady(d.options) {
		return snapshot
	}

	if packagedOSNativeTrayReady(d.options) {
		d.ensureTray(owner, snapshot)
		d.updateTrayMenu(owner, snapshot)
	}
	if packagedOSNativeNotificationsReady(d.options) {
		d.sendNotificationCandidates(ctx, owner, snapshot)
	}
	if packagedOSNativeDockBadgesReady(d.options) {
		d.updateDockBadge(ctx, snapshot)
	}
	d.requestAttentionIfNeeded(owner, snapshot)

	return d.Decorate(snapshot)
}

func (d *PackagedOSNativeDelivery) ensureTray(owner *App, snapshot BackgroundShellStatusSnapshot) {
	if owner == nil || owner.wailsApp == nil {
		return
	}

	d.mu.Lock()
	if d.trayReady {
		d.mu.Unlock()
		return
	}
	tray := owner.wailsApp.SystemTray.New()
	tray.SetTooltip("Arlecchino Background")
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(icons.SystrayMacTemplate)
	}
	d.tray = tray
	d.trayReady = true
	d.mu.Unlock()

	d.updateTrayMenu(owner, snapshot)
}

func (d *PackagedOSNativeDelivery) updateTrayMenu(owner *App, snapshot BackgroundShellStatusSnapshot) {
	if owner == nil || owner.wailsApp == nil {
		return
	}

	d.mu.Lock()
	tray := d.tray
	trayReady := d.trayReady
	d.mu.Unlock()
	if !trayReady || tray == nil {
		return
	}

	model := buildPackagedOSNativeTrayModel(snapshot)
	menu := owner.wailsApp.NewMenu()
	menu.Add(model.Title).SetEnabled(false)
	menu.Add(model.StatusLabel).SetEnabled(false)
	menu.AddSeparator()
	if len(model.Actions) == 0 {
		menu.Add(model.EmptyLabel).SetEnabled(false)
	} else {
		for _, action := range model.Actions {
			actionID := action.ID
			item := menu.Add(action.Label).SetEnabled(action.Enabled)
			if action.Enabled {
				item.OnClick(func(*application.Context) {
					go func() {
						_, _ = owner.RunBackgroundShellAction(actionID)
					}()
				})
			}
		}
	}
	tray.SetMenu(menu)
}

func (d *PackagedOSNativeDelivery) sendNotificationCandidates(
	ctx context.Context,
	owner *App,
	snapshot BackgroundShellStatusSnapshot,
) {
	now := time.Now().UnixMilli()
	d.mu.Lock()
	candidates := selectPackagedOSNativeNotificationCandidates(snapshot, d.sentNotificationKeys, now)
	d.mu.Unlock()
	if len(candidates) == 0 {
		return
	}

	service, ok := d.ensureNotificationService(ctx, owner)
	useSwiftBridge := nativeMacOSBridgeAvailable()
	if !useSwiftBridge && (!ok || service == nil) {
		return
	}

	for _, candidate := range candidates {
		d.recordNotificationDeliveryAttempt("attempted")
		key := packagedOSNativeNotificationKey(candidate)
		if key == "" {
			continue
		}
		if useSwiftBridge {
			if _, err := callNativeMacOSBridge("notification.send", nativeNotificationPayload(candidate, key)); err != nil {
				d.recordNotificationDeliveryAttempt("failed")
				d.setLastError(fmt.Sprintf("native notification failed: %v", err))
				continue
			}
			d.mu.Lock()
			d.sentNotificationKeys[key] = now
			d.pendingNotificationKeys[candidate.ID] = key
			d.notificationDeliveryResult = "pending"
			d.mu.Unlock()
			continue
		} else if err := service.SendNotification(wailsNotificationOptions(candidate, key)); err != nil {
			d.recordNotificationDeliveryAttempt("failed")
			d.setLastError(fmt.Sprintf("native notification failed: %v", err))
			continue
		}

		d.mu.Lock()
		d.sentNotificationKeys[key] = now
		d.sentNotificationCount++
		d.notificationDeliveryResult = "delivered"
		d.mu.Unlock()
	}
}

func wailsNotificationOptions(candidate BackgroundShellNotificationCandidate, key string) notifications.NotificationOptions {
	options := notifications.NotificationOptions{
		ID:    candidate.ID,
		Title: candidate.Title,
		Body:  candidate.Body,
		Data: map[string]interface{}{
			"jobId":     candidate.JobID,
			"dedupeKey": key,
		},
	}
	if candidate.Action != nil {
		options.Data["backgroundActionId"] = candidate.Action.ID
		options.Data["surfaceId"] = candidate.Action.OwnerSurfaceID
	}
	return options
}

func nativeNotificationPayload(candidate BackgroundShellNotificationCandidate, key string) map[string]any {
	data := map[string]any{
		"jobId":     candidate.JobID,
		"dedupeKey": key,
		"severity":  string(candidate.Severity),
	}
	if candidate.Action != nil {
		data["backgroundActionId"] = candidate.Action.ID
		data["surfaceId"] = candidate.Action.OwnerSurfaceID
		data["actionIntent"] = candidate.Action.Intent
	}
	return map[string]any{
		"id":    candidate.ID,
		"title": candidate.Title,
		"body":  candidate.Body,
		"data":  data,
	}
}

func (d *PackagedOSNativeDelivery) ensureNotificationService(
	ctx context.Context,
	owner *App,
) (*notifications.NotificationService, bool) {
	if nativeMacOSBridgeAvailable() {
		d.mu.Lock()
		d.notificationStartupAttempted = true
		if d.notificationPermissionStatus == "" {
			d.notificationPermissionStatus = "bridge-pending"
		}
		d.mu.Unlock()
		return nil, true
	}
	if ctx == nil {
		return nil, false
	}

	d.mu.Lock()
	if d.notificationStartupAttempted {
		service := d.notificationService
		ready := d.notificationReady
		d.mu.Unlock()
		return service, ready
	}
	service := d.notificationService
	if service == nil {
		service = notifications.New()
		if owner != nil {
			service.OnNotificationResponse(func(result notifications.NotificationResult) {
				d.handleNotificationResponse(owner, result)
			})
		}
		d.notificationService = service
	}
	d.notificationStartupAttempted = true
	d.mu.Unlock()

	if err := service.ServiceStartup(ctx, application.ServiceOptions{Name: "NativeNotifications"}); err != nil {
		d.setLastError(fmt.Sprintf("native notifications unavailable: %v", err))
		return service, false
	}

	authorized, err := service.CheckNotificationAuthorization()
	if err != nil {
		d.recordNotificationPermission("check-failed", false)
		d.setLastError(fmt.Sprintf("native notification authorization failed: %v", err))
		return service, false
	}
	if err == nil && !authorized {
		d.recordNotificationPermission("requested", true)
		authorized, err = service.RequestNotificationAuthorization()
	}
	if err != nil {
		d.recordNotificationPermission("request-failed", true)
		d.setLastError(fmt.Sprintf("native notification authorization failed: %v", err))
		return service, false
	}
	if !authorized {
		d.recordNotificationPermission("denied", true)
		d.setLastError("native notification authorization was not granted")
		return service, false
	}

	d.mu.Lock()
	d.notificationReady = true
	if d.notificationPermissionStatus == "" || d.notificationPermissionStatus == "requested" {
		d.notificationPermissionStatus = "granted"
	}
	d.mu.Unlock()
	return service, true
}

func (d *PackagedOSNativeDelivery) recordNotificationPermission(status string, requested bool) {
	if d == nil {
		return
	}
	d.mu.Lock()
	if requested {
		d.notificationPermissionRequested = true
	}
	d.notificationPermissionStatus = strings.TrimSpace(status)
	d.mu.Unlock()
}

func (d *PackagedOSNativeDelivery) recordNotificationDeliveryAttempt(result string) {
	if d == nil {
		return
	}
	d.mu.Lock()
	d.notificationDeliveryAttempted = true
	if strings.TrimSpace(result) != "" {
		d.notificationDeliveryResult = strings.TrimSpace(result)
	}
	d.mu.Unlock()
}

func (d *PackagedOSNativeDelivery) recordNativeNotificationDelivered(id string) {
	if d == nil {
		return
	}
	id = strings.TrimSpace(id)
	d.mu.Lock()
	hadPending := false
	if key := d.pendingNotificationKeys[id]; key != "" {
		delete(d.pendingNotificationKeys, id)
		hadPending = true
	}
	d.notificationReady = true
	d.notificationPermissionStatus = "granted"
	d.notificationDeliveryAttempted = true
	d.notificationDeliveryResult = "delivered"
	if hadPending {
		d.sentNotificationCount++
	}
	d.mu.Unlock()
}

func (d *PackagedOSNativeDelivery) recordNativeNotificationFailure(id string, status string) {
	if d == nil {
		return
	}
	id = strings.TrimSpace(id)
	status = strings.TrimSpace(status)
	d.mu.Lock()
	if key := d.pendingNotificationKeys[id]; key != "" {
		delete(d.pendingNotificationKeys, id)
		delete(d.sentNotificationKeys, key)
	}
	d.notificationDeliveryAttempted = true
	d.notificationDeliveryResult = "failed"
	if status != "" {
		d.notificationPermissionStatus = status
	}
	d.mu.Unlock()
	if status == "denied" {
		d.recordNotificationPermission("denied", true)
		d.recordFailureState("no-permission")
		return
	}
	d.recordFailureState("delivery-failed")
}

func (d *PackagedOSNativeDelivery) handleNotificationResponse(
	owner *App,
	result notifications.NotificationResult,
) {
	if owner == nil {
		return
	}
	if result.Error != nil {
		d.setLastError(fmt.Sprintf("native notification response failed: %v", result.Error))
		return
	}
	actionID, _ := result.Response.UserInfo["backgroundActionId"].(string)
	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		return
	}
	go func() {
		if _, err := owner.RunBackgroundShellAction(actionID); err != nil {
			d.recordFailureState("action-rejected")
			d.setLastError(fmt.Sprintf("native notification action rejected: %v", err))
		}
	}()
}

func (a *App) handleNativeNotificationBridgeResponse(payload map[string]any) {
	if a == nil || len(payload) == 0 {
		return
	}
	userInfo := payload
	if nested, ok := payload["userInfo"].(map[string]any); ok {
		userInfo = nested
	}
	actionID := strings.TrimSpace(stringMapValue(userInfo, "backgroundActionId"))
	if actionID != "" {
		go func() {
			if _, err := a.RunBackgroundShellAction(actionID); err != nil && a.packagedOSNative != nil {
				a.packagedOSNative.recordFailureState("action-rejected")
				a.packagedOSNative.setLastError(fmt.Sprintf("native notification action rejected: %v", err))
			}
		}()
		return
	}
	if a.showLastActiveWindow() {
		return
	}
}

func (a *App) handleNativeNotificationBridgeDelivered(payload map[string]any) {
	if a == nil || a.packagedOSNative == nil {
		return
	}
	a.packagedOSNative.recordNativeNotificationDelivered(stringMapValue(payload, "id"))
}

func (a *App) handleNativeNotificationBridgeFailure(eventName string, payload map[string]any) {
	if a == nil || a.packagedOSNative == nil {
		return
	}
	status := "error"
	if strings.TrimSpace(eventName) == "notification.denied" {
		status = "denied"
	}
	a.packagedOSNative.recordNativeNotificationFailure(stringMapValue(payload, "id"), status)
	if status == "error" {
		if message := strings.TrimSpace(stringMapValue(payload, "error")); message != "" {
			a.packagedOSNative.setLastError("native notification failed: " + message)
		}
	}
}

func stringMapValue(values map[string]any, key string) string {
	if len(values) == 0 {
		return ""
	}
	switch value := values[key].(type) {
	case string:
		return value
	default:
		return ""
	}
}

func (d *PackagedOSNativeDelivery) updateDockBadge(ctx context.Context, snapshot BackgroundShellStatusSnapshot) {
	label := packagedOSNativeDockBadgeLabel(snapshot)

	d.mu.Lock()
	if d.lastDockBadge == label {
		d.mu.Unlock()
		return
	}
	d.mu.Unlock()

	if nativeMacOSBridgeAvailable() {
		if _, err := callNativeMacOSBridge("dock.setBadge", map[string]any{"label": label}); err != nil {
			d.setLastError(fmt.Sprintf("dock badge update failed: %v", err))
			return
		}
	} else {
		service, ok := d.ensureDockService(ctx)
		if !ok || service == nil {
			return
		}

		var err error
		if label == "" {
			err = service.RemoveBadge()
		} else {
			err = service.SetBadge(label)
		}
		if err != nil {
			d.setLastError(fmt.Sprintf("dock badge update failed: %v", err))
			return
		}
	}

	d.mu.Lock()
	d.lastDockBadge = label
	d.dockReady = true
	d.mu.Unlock()
}

func (d *PackagedOSNativeDelivery) requestAttentionIfNeeded(owner *App, snapshot BackgroundShellStatusSnapshot) {
	if d == nil || owner == nil || snapshot.AttentionCount <= 0 || owner.hasVisibleWindow() {
		return
	}
	if !nativeMacOSBridgeAvailable() {
		return
	}

	d.mu.Lock()
	if d.lastAttentionRevision == snapshot.Revision {
		d.mu.Unlock()
		return
	}
	d.lastAttentionRevision = snapshot.Revision
	d.mu.Unlock()

	critical := false
	for _, candidate := range snapshot.NotificationCandidates {
		if candidate.Severity == BackgroundShellSeverityError {
			critical = true
			break
		}
	}
	if _, err := callNativeMacOSBridge("attention.request", map[string]any{"critical": critical}); err != nil {
		d.setLastError(fmt.Sprintf("dock attention request failed: %v", err))
	}
}

func (d *PackagedOSNativeDelivery) ensureDockService(ctx context.Context) (*dock.DockService, bool) {
	if ctx == nil {
		return nil, false
	}

	d.mu.Lock()
	if d.dockStartupAttempted {
		service := d.dockService
		ready := d.dockReady
		d.mu.Unlock()
		return service, ready
	}
	service := d.dockService
	if service == nil {
		service = dock.New()
		d.dockService = service
	}
	d.dockStartupAttempted = true
	d.mu.Unlock()

	if err := service.ServiceStartup(ctx, application.ServiceOptions{Name: "DockBadges"}); err != nil {
		d.setLastError(fmt.Sprintf("dock badge service unavailable: %v", err))
		return service, false
	}

	d.mu.Lock()
	d.dockReady = true
	d.mu.Unlock()
	return service, true
}

func (d *PackagedOSNativeDelivery) setLastError(message string) {
	if d == nil {
		return
	}
	d.mu.Lock()
	d.lastError = message
	if state := classifyPackagedOSNativeFailureState(message); state != "" {
		if d.failures == nil {
			d.failures = make(map[string]struct{})
		}
		d.failures[state] = struct{}{}
	}
	d.mu.Unlock()
}

func (d *PackagedOSNativeDelivery) recordFailureState(state string) {
	if d == nil {
		return
	}
	state = strings.TrimSpace(state)
	if state == "" {
		return
	}
	d.mu.Lock()
	if d.failures == nil {
		d.failures = make(map[string]struct{})
	}
	d.failures[state] = struct{}{}
	d.mu.Unlock()
}

func classifyPackagedOSNativeFailureState(message string) string {
	message = strings.ToLower(strings.TrimSpace(message))
	switch {
	case message == "":
		return ""
	case strings.Contains(message, "authorization") ||
		strings.Contains(message, "permission") ||
		strings.Contains(message, "not granted"):
		return "no-permission"
	case strings.Contains(message, "unavailable") ||
		strings.Contains(message, "service"):
		return "startup-failed"
	case strings.Contains(message, "failed"):
		return "delivery-failed"
	default:
		return ""
	}
}
