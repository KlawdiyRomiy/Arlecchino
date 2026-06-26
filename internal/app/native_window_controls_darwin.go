//go:build darwin && !arle_swift_bridge

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#include <stdbool.h>
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static char arlecchinoOriginalButtonsSuperviewFrameKey;
static char arlecchinoOriginalButtonsSuperviewKey;
static char arlecchinoWindowButtonPlacementKey;
static char arlecchinoWindowButtonMoveObserverKey;
static char arlecchinoWindowButtonEventForwarderKey;

static NSWindow* arlecchinoControlsWindow(void *preferredWindow) {
    if (preferredWindow != nil) {
        return (NSWindow*)preferredWindow;
    }

    NSWindow *window = [NSApp keyWindow];
    if (window == nil) {
        window = [NSApp mainWindow];
    }
    if (window == nil) {
        for (NSWindow *candidate in [NSApp windows]) {
            if ([candidate isVisible]) {
                window = candidate;
                break;
            }
        }
    }
    if (window == nil && [[NSApp windows] count] > 0) {
        window = [[NSApp windows] objectAtIndex:0];
    }
    return window;
}

static CGFloat arlecchinoButtonCenterX(NSButton *button) {
    NSRect frame = [button frame];
    return frame.origin.x + (frame.size.width / 2.0);
}

static CGFloat arlecchinoButtonCenterY(NSButton *button) {
    NSRect frame = [button frame];
    return frame.origin.y + (frame.size.height / 2.0);
}

static bool arlecchinoWindowIsFullscreen(NSWindow *window) {
    return window != nil && ([window styleMask] & NSWindowStyleMaskFullScreen) == NSWindowStyleMaskFullScreen;
}

static NSView* arlecchinoWindowButtonsSuperview(
    NSButton *closeButton,
    NSButton *minimiseButton,
    NSButton *maximiseButton
) {
    if (
        closeButton == nil ||
        minimiseButton == nil ||
        maximiseButton == nil ||
        [closeButton superview] == nil ||
        [closeButton superview] != [minimiseButton superview] ||
        [closeButton superview] != [maximiseButton superview]
    ) {
        return nil;
    }

    return [closeButton superview];
}

static void arlecchinoRefreshNativeControlView(NSView *view, NSWindow *window) {
    if (view == nil) {
        return;
    }

    [view setNeedsDisplay:YES];
    [view updateTrackingAreas];
    if (window != nil) {
        [window invalidateCursorRectsForView:view];
    }
}

static void arlecchinoRefreshWindowButtons(
    NSButton *closeButton,
    NSButton *minimiseButton,
    NSButton *maximiseButton
) {
    NSView *buttonSuperview = arlecchinoWindowButtonsSuperview(closeButton, minimiseButton, maximiseButton);
    if (buttonSuperview == nil) {
        return;
    }

    NSWindow *window = [buttonSuperview window];
    arlecchinoRefreshNativeControlView(closeButton, window);
    arlecchinoRefreshNativeControlView(minimiseButton, window);
    arlecchinoRefreshNativeControlView(maximiseButton, window);

    for (NSView *view = buttonSuperview; view != nil; view = [view superview]) {
        arlecchinoRefreshNativeControlView(view, window);
    }
    if (window != nil) {
        [window recalculateKeyViewLoop];
    }
}

static bool arlecchinoWindowButtonCanReceiveForwardedEvent(NSButton *button) {
    if (button == nil || ![button isEnabled] || [button isHiddenOrHasHiddenAncestor]) {
        return false;
    }
    if ([button superview] == nil || [button window] == nil) {
        return false;
    }
    return true;
}

static bool arlecchinoWindowButtonContainsEvent(NSButton *button, NSEvent *event) {
    if (!arlecchinoWindowButtonCanReceiveForwardedEvent(button) || event == nil) {
        return false;
    }

    NSView *superview = [button superview];
    NSRect frameInWindow = [superview convertRect:[button frame] toView:nil];
    return NSPointInRect([event locationInWindow], frameInWindow);
}

static NSButton* arlecchinoWindowButtonForEvent(NSWindow *window, NSEvent *event) {
    if (window == nil || event == nil || [event window] != window) {
        return nil;
    }

    NSButton *buttons[] = {
        [window standardWindowButton:NSWindowCloseButton],
        [window standardWindowButton:NSWindowMiniaturizeButton],
        [window standardWindowButton:NSWindowZoomButton],
    };
    for (NSUInteger index = 0; index < 3; index++) {
        NSButton *button = buttons[index];
        if (arlecchinoWindowButtonContainsEvent(button, event)) {
            return button;
        }
    }
    return nil;
}

static bool arlecchinoPositionNativeWindowControlsOnMainThread(
    void *preferredWindow,
    double closeX, double closeY,
    double minimiseX, double minimiseY,
    double maximiseX, double maximiseY,
    bool visible
);

static void arlecchinoRememberWindowButtonPlacement(
    NSWindow *window,
    double closeX,
    double closeY,
    double minimiseY,
    double maximiseY,
    bool visible
) {
    if (window == nil) {
        return;
    }

    NSDictionary *placement = @{
        @"closeX": @(closeX),
        @"closeY": @(closeY),
        @"minimiseY": @(minimiseY),
        @"maximiseY": @(maximiseY),
        @"visible": @(visible),
    };
    objc_setAssociatedObject(
        window,
        &arlecchinoWindowButtonPlacementKey,
        placement,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC
    );
}

static void arlecchinoRepositionRememberedWindowButtons(NSWindow *window) {
    NSDictionary *placement = objc_getAssociatedObject(window, &arlecchinoWindowButtonPlacementKey);
    if (window == nil || ![placement isKindOfClass:[NSDictionary class]]) {
        return;
    }

    NSNumber *closeX = placement[@"closeX"];
    NSNumber *closeY = placement[@"closeY"];
    NSNumber *minimiseY = placement[@"minimiseY"];
    NSNumber *maximiseY = placement[@"maximiseY"];
    NSNumber *visible = placement[@"visible"];
    if (
        ![closeX isKindOfClass:[NSNumber class]] ||
        ![closeY isKindOfClass:[NSNumber class]] ||
        ![minimiseY isKindOfClass:[NSNumber class]] ||
        ![maximiseY isKindOfClass:[NSNumber class]] ||
        ![visible isKindOfClass:[NSNumber class]]
    ) {
        return;
    }

    arlecchinoPositionNativeWindowControlsOnMainThread(
        window,
        [closeX doubleValue],
        [closeY doubleValue],
        [closeX doubleValue],
        [minimiseY doubleValue],
        [closeX doubleValue],
        [maximiseY doubleValue],
        [visible boolValue]
    );
}

static void arlecchinoScheduleRememberedWindowButtonsReposition(NSWindow *window) {
    if (window == nil) {
        return;
    }

    NSWindow *scheduledWindow = [window retain];
    dispatch_async(dispatch_get_main_queue(), ^{
        arlecchinoRepositionRememberedWindowButtons(scheduledWindow);
        [scheduledWindow release];
    });
}

@interface ArlecchinoWindowButtonMoveObserver : NSObject {
@private
    NSWindow *_window;
}
- (instancetype)initWithWindow:(NSWindow*)window;
- (void)windowWillMove:(NSNotification*)notification;
- (void)windowDidMove:(NSNotification*)notification;
- (void)windowWillResize:(NSNotification*)notification;
- (void)windowDidResize:(NSNotification*)notification;
@end

@implementation ArlecchinoWindowButtonMoveObserver

- (instancetype)initWithWindow:(NSWindow*)window {
    self = [super init];
    if (self != nil) {
        _window = window;
        NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
        [center addObserver:self selector:@selector(windowWillMove:) name:NSWindowWillMoveNotification object:window];
        [center addObserver:self selector:@selector(windowDidMove:) name:NSWindowDidMoveNotification object:window];
        [center addObserver:self selector:@selector(windowWillResize:) name:NSWindowWillStartLiveResizeNotification object:window];
        [center addObserver:self selector:@selector(windowDidResize:) name:NSWindowDidResizeNotification object:window];
        [center addObserver:self selector:@selector(windowDidResize:) name:NSWindowDidEndLiveResizeNotification object:window];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [super dealloc];
}

- (void)windowWillMove:(NSNotification*)notification {
    arlecchinoRepositionRememberedWindowButtons(_window);
    arlecchinoScheduleRememberedWindowButtonsReposition(_window);
}

- (void)windowDidMove:(NSNotification*)notification {
    arlecchinoRepositionRememberedWindowButtons(_window);
    arlecchinoScheduleRememberedWindowButtonsReposition(_window);
}

- (void)windowWillResize:(NSNotification*)notification {
    arlecchinoRepositionRememberedWindowButtons(_window);
    arlecchinoScheduleRememberedWindowButtonsReposition(_window);
}

- (void)windowDidResize:(NSNotification*)notification {
    arlecchinoRepositionRememberedWindowButtons(_window);
    arlecchinoScheduleRememberedWindowButtonsReposition(_window);
}

@end

static void arlecchinoInstallWindowButtonMoveObserver(NSWindow *window) {
    if (window == nil) {
        return;
    }
    if (objc_getAssociatedObject(window, &arlecchinoWindowButtonMoveObserverKey) != nil) {
        return;
    }

    ArlecchinoWindowButtonMoveObserver *observer = [[ArlecchinoWindowButtonMoveObserver alloc] initWithWindow:window];
    objc_setAssociatedObject(
        window,
        &arlecchinoWindowButtonMoveObserverKey,
        observer,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC
    );
    [observer release];
}

static void arlecchinoInstallWindowButtonEventForwarder(NSWindow *window) {
    if (window == nil) {
        return;
    }
    if (objc_getAssociatedObject(window, &arlecchinoWindowButtonEventForwarderKey) != nil) {
        return;
    }

    __block NSButton *pressedButton = nil;
    NSEventMask eventMask = NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskLeftMouseDragged;
    id monitor = [NSEvent addLocalMonitorForEventsMatchingMask:eventMask handler:^NSEvent *(NSEvent *event) {
        if (event == nil || [event window] != window) {
            return event;
        }

        switch ([event type]) {
            case NSEventTypeLeftMouseDown: {
                NSButton *button = arlecchinoWindowButtonForEvent(window, event);
                if (button == nil) {
                    arlecchinoRepositionRememberedWindowButtons(window);
                    arlecchinoScheduleRememberedWindowButtonsReposition(window);
                    return event;
                }

                pressedButton = button;
                [button highlight:YES];
                return nil;
            }
            case NSEventTypeLeftMouseDragged: {
                if (pressedButton == nil) {
                    arlecchinoRepositionRememberedWindowButtons(window);
                    arlecchinoScheduleRememberedWindowButtonsReposition(window);
                    return event;
                }

                [pressedButton highlight:arlecchinoWindowButtonContainsEvent(pressedButton, event)];
                return nil;
            }
            case NSEventTypeLeftMouseUp: {
                NSButton *button = pressedButton;
                pressedButton = nil;
                if (button == nil) {
                    arlecchinoRepositionRememberedWindowButtons(window);
                    arlecchinoScheduleRememberedWindowButtonsReposition(window);
                    return event;
                }

                bool shouldClick = arlecchinoWindowButtonContainsEvent(button, event);
                [button highlight:NO];
                if (shouldClick && arlecchinoWindowButtonCanReceiveForwardedEvent(button)) {
                    [button performClick:nil];
                }
                return nil;
            }
            default:
                return event;
        }
    }];
    objc_setAssociatedObject(
        window,
        &arlecchinoWindowButtonEventForwarderKey,
        monitor,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC
    );
}

static void arlecchinoRememberWindowButtonsSuperviewFrame(NSView *buttonSuperview) {
    if (buttonSuperview == nil) {
        return;
    }

    if (objc_getAssociatedObject(buttonSuperview, &arlecchinoOriginalButtonsSuperviewFrameKey) == nil) {
        objc_setAssociatedObject(
            buttonSuperview,
            &arlecchinoOriginalButtonsSuperviewFrameKey,
            [NSValue valueWithRect:[buttonSuperview frame]],
            OBJC_ASSOCIATION_RETAIN_NONATOMIC
        );
    }

    if (objc_getAssociatedObject(buttonSuperview, &arlecchinoOriginalButtonsSuperviewKey) == nil && [buttonSuperview superview] != nil) {
        objc_setAssociatedObject(
            buttonSuperview,
            &arlecchinoOriginalButtonsSuperviewKey,
            [NSValue valueWithNonretainedObject:[buttonSuperview superview]],
            OBJC_ASSOCIATION_RETAIN_NONATOMIC
        );
    }
}

static NSView* arlecchinoOriginalButtonsSuperview(NSView *buttonSuperview) {
    NSValue *value = objc_getAssociatedObject(buttonSuperview, &arlecchinoOriginalButtonsSuperviewKey);
    if (value == nil) {
        return nil;
    }

    id originalSuperview = [value nonretainedObjectValue];
    if (![originalSuperview isKindOfClass:[NSView class]]) {
        return nil;
    }
    return (NSView*)originalSuperview;
}

static bool arlecchinoAttachButtonsSuperviewToParent(NSView *buttonSuperview, NSView *parentView, bool visible) {
    if (buttonSuperview == nil) {
        return false;
    }

    if (parentView == nil) {
        return false;
    }

    if ([buttonSuperview superview] != parentView) {
        [buttonSuperview retain];
        [buttonSuperview removeFromSuperviewWithoutNeedingDisplay];
        [parentView addSubview:buttonSuperview positioned:NSWindowAbove relativeTo:nil];
        [buttonSuperview release];
    }

    [buttonSuperview setHidden:visible ? NO : YES];
    [buttonSuperview setNeedsDisplay:YES];
    [buttonSuperview updateTrackingAreas];
    [parentView setNeedsDisplay:YES];
    [parentView updateTrackingAreas];
    NSWindow *window = [parentView window];
    if (window != nil) {
        [window invalidateCursorRectsForView:buttonSuperview];
        [window recalculateKeyViewLoop];
    }
    return true;
}

static bool arlecchinoRaiseWindowButtonsSuperview(NSView *buttonSuperview, bool visible) {
    if (buttonSuperview == nil) {
        return false;
    }

    return arlecchinoAttachButtonsSuperviewToParent(buttonSuperview, [buttonSuperview superview], visible);
}

static bool arlecchinoMoveWindowButtonsSuperviewToContentView(NSView *buttonSuperview, NSWindow *window, bool visible) {
    if (buttonSuperview == nil || window == nil) {
        return false;
    }

    NSView *contentView = [window contentView];
    if (contentView == nil) {
        return false;
    }

    return arlecchinoAttachButtonsSuperviewToParent(buttonSuperview, contentView, visible);
}

static bool arlecchinoRestoreWindowButtonsSuperview(
    NSButton *closeButton,
    NSButton *minimiseButton,
    NSButton *maximiseButton,
    bool visible
) {
    NSView *buttonSuperview = arlecchinoWindowButtonsSuperview(closeButton, minimiseButton, maximiseButton);
    if (buttonSuperview == nil) {
        return false;
    }

    NSValue *originalFrame = objc_getAssociatedObject(buttonSuperview, &arlecchinoOriginalButtonsSuperviewFrameKey);
    NSView *originalSuperview = arlecchinoOriginalButtonsSuperview(buttonSuperview);
    if (originalSuperview != nil && [buttonSuperview superview] != originalSuperview) {
        arlecchinoAttachButtonsSuperviewToParent(buttonSuperview, originalSuperview, visible);
    }
    if (originalFrame != nil) {
        [buttonSuperview setFrame:[originalFrame rectValue]];
    }
    arlecchinoRaiseWindowButtonsSuperview(buttonSuperview, visible);
    arlecchinoRefreshWindowButtons(closeButton, minimiseButton, maximiseButton);
    return true;
}

static bool arlecchinoMoveWindowButtonsSuperview(
    NSButton *closeButton,
    NSButton *minimiseButton,
    NSButton *maximiseButton,
    CGFloat closeX,
    CGFloat closeY,
    CGFloat minimiseY,
    CGFloat maximiseY,
    bool visible
) {
    NSView *buttonSuperview = arlecchinoWindowButtonsSuperview(closeButton, minimiseButton, maximiseButton);
    if (buttonSuperview == nil) {
        return false;
    }

    arlecchinoRememberWindowButtonsSuperviewFrame(buttonSuperview);
    NSWindow *window = [buttonSuperview window];
    if (!arlecchinoMoveWindowButtonsSuperviewToContentView(buttonSuperview, window, visible)) {
        arlecchinoRaiseWindowButtonsSuperview(buttonSuperview, visible);
    }

    NSView *parentView = [buttonSuperview superview];
    if (parentView == nil) {
        return false;
    }

    NSRect parentBounds = [parentView bounds];
    NSRect superviewFrame = [buttonSuperview frame];
    CGFloat desiredCenterY = (closeY + minimiseY + maximiseY) / 3.0;
    CGFloat currentCenterY =
        (arlecchinoButtonCenterY(closeButton) +
         arlecchinoButtonCenterY(minimiseButton) +
         arlecchinoButtonCenterY(maximiseButton)) / 3.0;
    CGFloat nextSuperviewY = parentBounds.size.height - desiredCenterY - currentCenterY;
    CGFloat nextSuperviewX = closeX - arlecchinoButtonCenterX(closeButton);

    superviewFrame.origin.x = nextSuperviewX;
    superviewFrame.origin.y = nextSuperviewY;
    [buttonSuperview setFrame:superviewFrame];
    arlecchinoRefreshWindowButtons(closeButton, minimiseButton, maximiseButton);
    return true;
}

static bool arlecchinoPositionNativeWindowControlsOnMainThread(
    void *preferredWindow,
    double closeX, double closeY,
    double minimiseX, double minimiseY,
    double maximiseX, double maximiseY,
    bool visible
) {
    NSWindow *window = arlecchinoControlsWindow(preferredWindow);
    if (window == nil) {
        return false;
    }

    NSButton *closeButton = [window standardWindowButton:NSWindowCloseButton];
    NSButton *minimiseButton = [window standardWindowButton:NSWindowMiniaturizeButton];
    NSButton *maximiseButton = [window standardWindowButton:NSWindowZoomButton];
    arlecchinoInstallWindowButtonMoveObserver(window);
    arlecchinoInstallWindowButtonEventForwarder(window);

    if (arlecchinoWindowIsFullscreen(window)) {
        return arlecchinoRestoreWindowButtonsSuperview(closeButton, minimiseButton, maximiseButton, visible);
    }

    arlecchinoRememberWindowButtonPlacement(window, closeX, closeY, minimiseY, maximiseY, visible);
    return arlecchinoMoveWindowButtonsSuperview(
        closeButton,
        minimiseButton,
        maximiseButton,
        closeX,
        closeY,
        minimiseY,
        maximiseY,
        visible
    );
}

static bool arlecchinoPositionNativeWindowControls(
    void *preferredWindow,
    double closeX, double closeY,
    double minimiseX, double minimiseY,
    double maximiseX, double maximiseY,
    bool visible
) {
    __block bool didPosition = false;
    void (^position)(void) = ^{
        didPosition = arlecchinoPositionNativeWindowControlsOnMainThread(
            preferredWindow,
            closeX, closeY,
            minimiseX, minimiseY,
            maximiseX, maximiseY,
            visible
        );
    };

    if ([NSThread isMainThread]) {
        position();
    } else {
        dispatch_sync(dispatch_get_main_queue(), position);
    }
    return didPosition;
}

*/
import "C"

import (
	"context"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) SetNativeWindowControlsVisible(ctx context.Context, visible bool) bool {
	window := a.nativeWindowControlsTarget(ctx)
	if window == nil {
		return false
	}

	state := application.ButtonHidden
	if visible {
		state = application.ButtonEnabled
	}

	a.updateNativeWindowControlsState(window, func(controlsState *nativeWindowControlsState) {
		controlsState.visibleSet = true
		controlsState.visible = visible
	})

	window.SetCloseButtonState(state)
	window.SetMinimiseButtonState(state)
	window.SetMaximiseButtonState(state)
	window.SetFullscreenButtonState(state)
	a.refreshNativeWindowControlsForWindow(window)
	return true
}

func (a *App) PositionNativeWindowControls(ctx context.Context, closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY float64) bool {
	window := a.nativeWindowControlsTarget(ctx)
	if window == nil {
		return false
	}

	inset := nativeWindowControlsInset{
		closeCenterX:  closeX,
		buttonCenterY: (closeY + minimiseY + maximiseY) / 3,
	}
	a.updateNativeWindowControlsState(window, func(controlsState *nativeWindowControlsState) {
		controlsState.insetSet = true
		controlsState.inset = inset
	})

	return a.positionNativeWindowControls(window, inset, a.nativeWindowControlsVisible(window))
}

func (a *App) RefreshNativeWindowControls(ctx context.Context) bool {
	return a.refreshNativeWindowControlsForWindow(a.nativeWindowControlsTarget(ctx))
}

func (a *App) refreshNativeWindowControlsForWindow(window application.Window) bool {
	state, ok := a.nativeWindowControlsState(window)
	if !ok || !state.insetSet {
		return false
	}
	return a.positionNativeWindowControls(window, state.inset, nativeWindowControlsVisible(state))
}

func (a *App) positionNativeWindowControls(window application.Window, inset nativeWindowControlsInset, visible bool) bool {
	var nativeWindow unsafe.Pointer
	if window != nil {
		nativeWindow = window.NativeWindow()
	}
	return bool(C.arlecchinoPositionNativeWindowControls(
		nativeWindow,
		C.double(inset.closeCenterX),
		C.double(inset.buttonCenterY),
		C.double(inset.closeCenterX),
		C.double(inset.buttonCenterY),
		C.double(inset.closeCenterX),
		C.double(inset.buttonCenterY),
		C.bool(visible),
	))
}
