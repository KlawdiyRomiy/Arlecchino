package app

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	nativeContextMenuActionEvent = "ide:context-menu:action"
	maxNativeContextMenuItems    = 32
	maxNativeContextMenus        = 24
)

var nativeContextMenuState = struct {
	sync.Mutex
	menuIDs []string
}{}

type NativeContextMenuItem struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Disabled  bool   `json:"disabled"`
	Danger    bool   `json:"danger"`
	Separator bool   `json:"separator"`
	Hidden    bool   `json:"hidden"`
}

type NativeContextMenuRequest struct {
	MenuInstanceID string                  `json:"menuInstanceId"`
	Scope          string                  `json:"scope"`
	SurfaceID      string                  `json:"surfaceId"`
	TargetID       string                  `json:"targetId"`
	X              float64                 `json:"x"`
	Y              float64                 `json:"y"`
	Items          []NativeContextMenuItem `json:"items"`
	Context        map[string]any          `json:"context"`
}

type NativeContextMenuResponse struct {
	Opened         bool   `json:"opened"`
	MenuID         string `json:"menuId,omitempty"`
	MenuInstanceID string `json:"menuInstanceId,omitempty"`
	Reason         string `json:"reason,omitempty"`
}

func (a *App) OpenNativeContextMenu(request NativeContextMenuRequest) (NativeContextMenuResponse, error) {
	if a == nil || a.wailsApp == nil || a.mainWindow == nil {
		return NativeContextMenuResponse{
			Opened: false,
			Reason: "native context menu requires an initialized Wails app and main window",
		}, nil
	}

	menuInstanceID := strings.TrimSpace(request.MenuInstanceID)
	if menuInstanceID == "" {
		menuInstanceID = fmt.Sprintf("context-menu-%d", time.Now().UTC().UnixNano())
	}

	menuItems := normalizeNativeContextMenuItems(request.Items)
	if len(menuItems) == 0 {
		return NativeContextMenuResponse{
			Opened:         false,
			MenuInstanceID: menuInstanceID,
			Reason:         "native context menu has no visible actions",
		}, nil
	}

	menuID := fmt.Sprintf("arlecchino-context-%d", time.Now().UTC().UnixNano())
	menu := a.wailsApp.ContextMenu.New()
	for _, menuItem := range menuItems {
		if menuItem.Separator {
			menu.AddSeparator()
			continue
		}

		actionID := menuItem.ID
		item := menu.Add(menuItem.Label).SetEnabled(!menuItem.Disabled)
		item.OnClick(func(_ *application.Context) {
			a.emitEvent(nativeContextMenuActionEvent, map[string]any{
				"actionId":       actionID,
				"menuInstanceId": menuInstanceID,
				"scope":          request.Scope,
				"surfaceId":      request.SurfaceID,
				"targetId":       request.TargetID,
				"context":        cloneNativeContextMenuContext(request.Context),
			})
			a.removeNativeContextMenu(menuID)
		})
	}

	a.addNativeContextMenu(menuID, menu)
	a.mainWindow.OpenContextMenu(&application.ContextMenuData{
		Id:   menuID,
		X:    int(request.X),
		Y:    int(request.Y),
		Data: menuInstanceID,
	})

	return NativeContextMenuResponse{
		Opened:         true,
		MenuID:         menuID,
		MenuInstanceID: menuInstanceID,
	}, nil
}

func normalizeNativeContextMenuItems(items []NativeContextMenuItem) []NativeContextMenuItem {
	normalized := make([]NativeContextMenuItem, 0, len(items))
	previousWasSeparator := true

	for _, item := range items {
		if len(normalized) >= maxNativeContextMenuItems {
			break
		}
		if item.Hidden {
			continue
		}
		if item.Separator {
			if previousWasSeparator {
				continue
			}
			normalized = append(normalized, NativeContextMenuItem{Separator: true})
			previousWasSeparator = true
			continue
		}

		label := strings.TrimSpace(item.Label)
		actionID := strings.TrimSpace(item.ID)
		if label == "" || actionID == "" {
			continue
		}

		normalized = append(normalized, NativeContextMenuItem{
			ID:       actionID,
			Label:    label,
			Disabled: item.Disabled,
			Danger:   item.Danger,
		})
		previousWasSeparator = false
	}

	for len(normalized) > 0 && normalized[len(normalized)-1].Separator {
		normalized = normalized[:len(normalized)-1]
	}

	return normalized
}

func cloneNativeContextMenuContext(context map[string]any) map[string]any {
	if context == nil {
		return nil
	}
	clone := make(map[string]any, len(context))
	for key, value := range context {
		clone[key] = value
	}
	return clone
}

func (a *App) addNativeContextMenu(menuID string, menu *application.ContextMenu) {
	a.wailsApp.ContextMenu.Add(menuID, menu)

	nativeContextMenuState.Lock()
	nativeContextMenuState.menuIDs = append(nativeContextMenuState.menuIDs, menuID)
	staleMenus := []string(nil)
	if len(nativeContextMenuState.menuIDs) > maxNativeContextMenus {
		staleMenus = append(staleMenus, nativeContextMenuState.menuIDs[:len(nativeContextMenuState.menuIDs)-maxNativeContextMenus]...)
		nativeContextMenuState.menuIDs = append([]string(nil), nativeContextMenuState.menuIDs[len(nativeContextMenuState.menuIDs)-maxNativeContextMenus:]...)
	}
	nativeContextMenuState.Unlock()

	for _, staleMenuID := range staleMenus {
		a.wailsApp.ContextMenu.Remove(staleMenuID)
	}
}

func (a *App) removeNativeContextMenu(menuID string) {
	if a == nil || a.wailsApp == nil || strings.TrimSpace(menuID) == "" {
		return
	}

	a.wailsApp.ContextMenu.Remove(menuID)

	nativeContextMenuState.Lock()
	defer nativeContextMenuState.Unlock()
	nextMenuIDs := nativeContextMenuState.menuIDs[:0]
	for _, currentMenuID := range nativeContextMenuState.menuIDs {
		if currentMenuID != menuID {
			nextMenuIDs = append(nextMenuIDs, currentMenuID)
		}
	}
	nativeContextMenuState.menuIDs = nextMenuIDs
}
