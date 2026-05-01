package main

import (
	"context"
	"fmt"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"

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
	sentNotificationKeys            map[string]struct{}
	sentNotificationCount           int

	dockService          *dock.DockService
	dockStartupAttempted bool
	dockReady            bool
	lastDockBadge        string

	lastError string
	failures  map[string]struct{}
}

func NewPackagedOSNativeDelivery(options PackagedOSIntegrationOptions) *PackagedOSNativeDelivery {
	return &PackagedOSNativeDelivery{
		options:              options,
		sentNotificationKeys: make(map[string]struct{}),
		failures:             make(map[string]struct{}),
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
	if !options.PackagedBuild || !options.SpikeEnabled {
		return false
	}
	return options.NativeTrayEnabled ||
		options.NativeNotificationsEnabled ||
		options.DockBadgesEnabled
}

func packagedOSNativeTrayReady(options PackagedOSIntegrationOptions) bool {
	return options.PackagedBuild && options.SpikeEnabled && options.NativeTrayEnabled
}

func packagedOSNativeNotificationsReady(options PackagedOSIntegrationOptions) bool {
	return options.PackagedBuild && options.SpikeEnabled && options.NativeNotificationsEnabled
}

func packagedOSNativeDockBadgesReady(options PackagedOSIntegrationOptions) bool {
	return options.PackagedBuild && options.SpikeEnabled && options.DockBadgesEnabled
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
	sent map[string]struct{},
) []BackgroundShellNotificationCandidate {
	if len(snapshot.NotificationCandidates) == 0 {
		return nil
	}
	if sent == nil {
		sent = map[string]struct{}{}
	}

	result := make([]BackgroundShellNotificationCandidate, 0, len(snapshot.NotificationCandidates))
	for _, candidate := range snapshot.NotificationCandidates {
		key := packagedOSNativeNotificationKey(candidate)
		if key == "" {
			continue
		}
		if _, ok := sent[key]; ok {
			continue
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
	d.mu.Lock()
	candidates := selectPackagedOSNativeNotificationCandidates(snapshot, d.sentNotificationKeys)
	d.mu.Unlock()
	if len(candidates) == 0 {
		return
	}

	service, ok := d.ensureNotificationService(ctx, owner)
	if !ok || service == nil {
		return
	}

	for _, candidate := range candidates {
		d.recordNotificationDeliveryAttempt("attempted")
		key := packagedOSNativeNotificationKey(candidate)
		if key == "" {
			continue
		}
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

		if err := service.SendNotification(options); err != nil {
			d.recordNotificationDeliveryAttempt("failed")
			d.setLastError(fmt.Sprintf("native notification failed: %v", err))
			continue
		}

		d.mu.Lock()
		d.sentNotificationKeys[key] = struct{}{}
		d.sentNotificationCount++
		d.notificationDeliveryResult = "delivered"
		d.mu.Unlock()
	}
}

func (d *PackagedOSNativeDelivery) ensureNotificationService(
	ctx context.Context,
	owner *App,
) (*notifications.NotificationService, bool) {
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
		_, _ = owner.RunBackgroundShellAction(actionID)
	}()
}

func (d *PackagedOSNativeDelivery) updateDockBadge(ctx context.Context, snapshot BackgroundShellStatusSnapshot) {
	service, ok := d.ensureDockService(ctx)
	if !ok || service == nil {
		return
	}

	label := packagedOSNativeDockBadgeLabel(snapshot)

	d.mu.Lock()
	if d.lastDockBadge == label {
		d.mu.Unlock()
		return
	}
	d.mu.Unlock()

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

	d.mu.Lock()
	d.lastDockBadge = label
	d.dockReady = true
	d.mu.Unlock()
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
