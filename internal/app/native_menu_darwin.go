//go:build darwin && !arle_swift_bridge

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#include <stdlib.h>

static NSMenuItem* arlecchinoFindSubmenuItem(NSString *title) {
    NSMenu *mainMenu = [NSApp mainMenu];
    if (mainMenu == nil) {
        return nil;
    }
    return [mainMenu itemWithTitle:title];
}

static BOOL arlecchinoIsWailsMenuItem(NSMenuItem *item) {
    return item != nil && item.action != nil && [NSStringFromSelector(item.action) isEqualToString:@"handleClick"];
}

static NSMenuItem* arlecchinoPreferredMenuItem(NSMenu *menu, NSString *title) {
    NSMenuItem *firstMatch = nil;
    NSMenuItem *wailsMatch = nil;

    for (NSInteger index = 0; index < [menu numberOfItems]; index++) {
        NSMenuItem *item = [menu itemAtIndex:index];
        if ([[item title] isEqualToString:title]) {
            if (firstMatch == nil) {
                firstMatch = item;
            }
            if (wailsMatch == nil && arlecchinoIsWailsMenuItem(item)) {
                wailsMatch = item;
            }
        }
    }

    return wailsMatch != nil ? wailsMatch : firstMatch;
}

static void arlecchinoDeduplicateMenuItem(NSMenu *menu, NSString *title, NSMenuItem *preferred) {
    if (menu == nil || preferred == nil) {
        return;
    }

    for (NSInteger index = [menu numberOfItems] - 1; index >= 0; index--) {
        NSMenuItem *item = [menu itemAtIndex:index];
        if (item != preferred && [[item title] isEqualToString:title]) {
            [menu removeItemAtIndex:index];
        }
    }
}

static void arlecchinoPatchFnMenuItem(const char *submenuCString, const char *itemCString, const char *keyCString) {
    NSString *submenuTitle = [[NSString alloc] initWithUTF8String:submenuCString];
    NSString *itemTitle = [[NSString alloc] initWithUTF8String:itemCString];
    NSString *key = [[NSString alloc] initWithUTF8String:keyCString];

    dispatch_async(dispatch_get_main_queue(), ^{
        NSMenuItem *submenuItem = arlecchinoFindSubmenuItem(submenuTitle);
        NSMenu *submenu = [submenuItem submenu];
        if (submenu == nil) {
            [submenuTitle release];
            [itemTitle release];
            [key release];
            return;
        }

        NSMenuItem *item = arlecchinoPreferredMenuItem(submenu, itemTitle);
        if (item == nil) {
            [submenuTitle release];
            [itemTitle release];
            [key release];
            return;
        }

        [item setKeyEquivalent:[key lowercaseString]];
        [item setKeyEquivalentModifierMask:NSEventModifierFlagFunction];
        arlecchinoDeduplicateMenuItem(submenu, itemTitle, item);
        [submenuTitle release];
        [itemTitle release];
        [key release];
    });
}

static void arlecchinoDeduplicateMenuItemByTitle(const char *submenuCString, const char *itemCString) {
    NSString *submenuTitle = [[NSString alloc] initWithUTF8String:submenuCString];
    NSString *itemTitle = [[NSString alloc] initWithUTF8String:itemCString];

    dispatch_async(dispatch_get_main_queue(), ^{
        NSMenuItem *submenuItem = arlecchinoFindSubmenuItem(submenuTitle);
        NSMenu *submenu = [submenuItem submenu];
        if (submenu != nil) {
            NSMenuItem *item = arlecchinoPreferredMenuItem(submenu, itemTitle);
            arlecchinoDeduplicateMenuItem(submenu, itemTitle, item);
        }
        [submenuTitle release];
        [itemTitle release];
    });
}
*/
import "C"

import (
	"strings"
	"unsafe"
)

func (a *App) patchNativeApplicationMenu(shortcuts map[string][]string) {
	submenu := C.CString("View")
	item := C.CString("Enter Full Screen")
	defer C.free(unsafe.Pointer(submenu))
	defer C.free(unsafe.Pointer(item))

	shortcut := firstMenuShortcut(shortcuts, "window.toggleFullscreen")
	parsed := parseShortcutParts(shortcut)
	if parsed.key == "" || !parsed.hasModifier("fn") {
		C.arlecchinoDeduplicateMenuItemByTitle(submenu, item)
		return
	}

	key := C.CString(parsed.key)
	defer C.free(unsafe.Pointer(key))

	C.arlecchinoPatchFnMenuItem(submenu, item, key)
}

type shortcutParts struct {
	key       string
	modifiers map[string]bool
}

func (s shortcutParts) hasModifier(modifier string) bool {
	return s.modifiers[modifier]
}

func parseShortcutParts(shortcut string) shortcutParts {
	parts := strings.Split(strings.TrimSpace(strings.ToLower(shortcut)), "+")
	if len(parts) == 0 {
		return shortcutParts{}
	}

	result := shortcutParts{
		key:       strings.TrimSpace(parts[len(parts)-1]),
		modifiers: make(map[string]bool, len(parts)-1),
	}
	for _, part := range parts[:len(parts)-1] {
		part = strings.TrimSpace(part)
		switch part {
		case "function", "globe":
			part = "fn"
		}
		if part != "" {
			result.modifiers[part] = true
		}
	}
	return result
}

func firstMenuShortcut(shortcuts map[string][]string, actionID string) string {
	for _, shortcut := range menuShortcutsForAction(actionID, shortcuts) {
		if strings.TrimSpace(shortcut) != "" {
			return shortcut
		}
	}
	return ""
}
