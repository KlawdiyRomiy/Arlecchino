//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#include <math.h>
#include <stdbool.h>
#include <stdlib.h>

#define ARLECCHINO_MAX_APPLICATION_ICON_REPS 12
#define ARLECCHINO_APPLICATION_ICON_BODY_RATIO (824.0 / 1024.0)
#define ARLECCHINO_APPLICATION_ICON_ALPHA_THRESHOLD 64

typedef struct {
    NSInteger pixelsWide;
    NSInteger pixelsHigh;
    CGFloat pointsWide;
    CGFloat pointsHigh;
} arlecchinoApplicationIconRepSpec;

typedef struct {
    CGFloat x;
    CGFloat y;
    CGFloat width;
    CGFloat height;
} arlecchinoApplicationIconRectRatio;

static NSImage* arlecchinoSystemApplicationIcon(void) {
    NSImage *icon = [[NSBundle mainBundle] imageForResource:@"appicon"];
    if (icon != nil && [icon size].width > 0 && [icon size].height > 0 && [[icon representations] count] > 0) {
        return icon;
    }
    return nil;
}

static NSSize arlecchinoApplicationIconImageSize(NSImage *systemIcon) {
    if (systemIcon != nil && [systemIcon size].width > 0 && [systemIcon size].height > 0) {
        return [systemIcon size];
    }
    return NSMakeSize(128, 128);
}

static bool arlecchinoApplicationIconRepSpecExists(
    arlecchinoApplicationIconRepSpec *specs,
    NSUInteger count,
    NSInteger pixelsWide,
    NSInteger pixelsHigh,
    CGFloat pointsWide,
    CGFloat pointsHigh
) {
    for (NSUInteger index = 0; index < count; index++) {
        arlecchinoApplicationIconRepSpec spec = specs[index];
        if (spec.pixelsWide == pixelsWide &&
            spec.pixelsHigh == pixelsHigh &&
            fabs(spec.pointsWide - pointsWide) < 0.5 &&
            fabs(spec.pointsHigh - pointsHigh) < 0.5) {
            return true;
        }
    }
    return false;
}

static void arlecchinoSetFallbackApplicationIconRepSpecs(
    arlecchinoApplicationIconRepSpec *specs,
    NSUInteger *count
) {
    specs[0] = (arlecchinoApplicationIconRepSpec){32, 32, 16, 16};
    specs[1] = (arlecchinoApplicationIconRepSpec){64, 64, 32, 32};
    specs[2] = (arlecchinoApplicationIconRepSpec){256, 256, 128, 128};
    specs[3] = (arlecchinoApplicationIconRepSpec){512, 512, 256, 256};
    specs[4] = (arlecchinoApplicationIconRepSpec){1024, 1024, 512, 512};
    *count = 5;
}

static void arlecchinoCopyApplicationIconRepSpecs(
    NSImage *systemIcon,
    arlecchinoApplicationIconRepSpec *specs,
    NSUInteger *count
) {
    *count = 0;
    if (systemIcon != nil) {
        for (NSImageRep *rep in [systemIcon representations]) {
            if (*count >= ARLECCHINO_MAX_APPLICATION_ICON_REPS) {
                break;
            }

            NSInteger pixelsWide = [rep pixelsWide];
            NSInteger pixelsHigh = [rep pixelsHigh];
            NSSize pointSize = [rep size];
            if (pixelsWide <= 0 || pixelsHigh <= 0 || pointSize.width <= 0 || pointSize.height <= 0) {
                continue;
            }

            if (arlecchinoApplicationIconRepSpecExists(
                    specs,
                    *count,
                    pixelsWide,
                    pixelsHigh,
                    pointSize.width,
                    pointSize.height
                )) {
                continue;
            }

            specs[*count] = (arlecchinoApplicationIconRepSpec){
                pixelsWide,
                pixelsHigh,
                pointSize.width,
                pointSize.height
            };
            *count += 1;
        }
    }

    if (*count == 0) {
        arlecchinoSetFallbackApplicationIconRepSpecs(specs, count);
    }
}

static arlecchinoApplicationIconRepSpec arlecchinoLargestApplicationIconRepSpec(
    arlecchinoApplicationIconRepSpec *specs,
    NSUInteger count
) {
    arlecchinoApplicationIconRepSpec largest = specs[0];
    for (NSUInteger index = 1; index < count; index++) {
        if (specs[index].pixelsWide * specs[index].pixelsHigh > largest.pixelsWide * largest.pixelsHigh) {
            largest = specs[index];
        }
    }
    return largest;
}

static NSBitmapImageRep* arlecchinoCreateApplicationIconBitmapRep(
    arlecchinoApplicationIconRepSpec spec
) {
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:nil
        pixelsWide:spec.pixelsWide
        pixelsHigh:spec.pixelsHigh
        bitsPerSample:8
        samplesPerPixel:4
        hasAlpha:YES
        isPlanar:NO
        colorSpaceName:NSDeviceRGBColorSpace
        bytesPerRow:0
        bitsPerPixel:0];
    if (rep != nil) {
        [rep setSize:NSMakeSize(spec.pointsWide, spec.pointsHigh)];
    }
    return rep;
}

static bool arlecchinoDrawApplicationIconImageInRep(
    NSImage *source,
    NSBitmapImageRep *rep,
    NSRect targetRect
) {
    if (source == nil || rep == nil) {
        return false;
    }

    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    if (context == nil) {
        return false;
    }

    NSSize repSize = [rep size];
    NSSize sourceSize = [source size];
    if (repSize.width <= 0 || repSize.height <= 0 || sourceSize.width <= 0 || sourceSize.height <= 0) {
        return false;
    }

    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:context];
    [context setImageInterpolation:NSImageInterpolationHigh];
    [[NSColor clearColor] setFill];
    NSRectFill(NSMakeRect(0, 0, repSize.width, repSize.height));
    [source drawInRect:targetRect
              fromRect:NSMakeRect(0, 0, sourceSize.width, sourceSize.height)
             operation:NSCompositingOperationSourceOver
              fraction:1.0];
    [NSGraphicsContext restoreGraphicsState];
    return true;
}

static arlecchinoApplicationIconRectRatio arlecchinoFallbackApplicationIconBodyRatio(void) {
    CGFloat inset = (1.0 - ARLECCHINO_APPLICATION_ICON_BODY_RATIO) / 2.0;
    return (arlecchinoApplicationIconRectRatio){
        inset,
        inset,
        ARLECCHINO_APPLICATION_ICON_BODY_RATIO,
        ARLECCHINO_APPLICATION_ICON_BODY_RATIO
    };
}

static bool arlecchinoMeasureApplicationIconBodyRatio(
    NSBitmapImageRep *rep,
    arlecchinoApplicationIconRectRatio *ratio
) {
    NSInteger pixelsWide = [rep pixelsWide];
    NSInteger pixelsHigh = [rep pixelsHigh];
    NSInteger samplesPerPixel = [rep samplesPerPixel];
    if (pixelsWide <= 0 || pixelsHigh <= 0 || samplesPerPixel <= 0) {
        return false;
    }

    NSInteger minX = pixelsWide;
    NSInteger minY = pixelsHigh;
    NSInteger maxX = -1;
    NSInteger maxY = -1;
    NSUInteger pixel[5] = {0, 0, 0, 0, 0};

    for (NSInteger y = 0; y < pixelsHigh; y++) {
        for (NSInteger x = 0; x < pixelsWide; x++) {
            [rep getPixel:pixel atX:x y:y];
            NSUInteger alpha = pixel[samplesPerPixel - 1];
            if (alpha < ARLECCHINO_APPLICATION_ICON_ALPHA_THRESHOLD) {
                continue;
            }

            if (x < minX) {
                minX = x;
            }
            if (y < minY) {
                minY = y;
            }
            if (x > maxX) {
                maxX = x;
            }
            if (y > maxY) {
                maxY = y;
            }
        }
    }

    if (maxX < minX || maxY < minY) {
        return false;
    }

    NSInteger bodyWidth = maxX - minX + 1;
    NSInteger bodyHeight = maxY - minY + 1;
    CGFloat widthRatio = (CGFloat)bodyWidth / (CGFloat)pixelsWide;
    CGFloat heightRatio = (CGFloat)bodyHeight / (CGFloat)pixelsHigh;
    if (widthRatio <= 0.35 || heightRatio <= 0.35 || widthRatio >= 0.96 || heightRatio >= 0.96) {
        return false;
    }

    *ratio = (arlecchinoApplicationIconRectRatio){
        (CGFloat)minX / (CGFloat)pixelsWide,
        (CGFloat)minY / (CGFloat)pixelsHigh,
        widthRatio,
        heightRatio
    };
    return true;
}

static arlecchinoApplicationIconRectRatio arlecchinoApplicationIconBodyRatio(
    NSImage *systemIcon,
    arlecchinoApplicationIconRepSpec largestSpec
) {
    if (systemIcon == nil) {
        return arlecchinoFallbackApplicationIconBodyRatio();
    }

    NSBitmapImageRep *rep = arlecchinoCreateApplicationIconBitmapRep(largestSpec);
    if (rep == nil) {
        return arlecchinoFallbackApplicationIconBodyRatio();
    }

    NSRect fullRect = NSMakeRect(0, 0, largestSpec.pointsWide, largestSpec.pointsHigh);
    bool rendered = arlecchinoDrawApplicationIconImageInRep(systemIcon, rep, fullRect);
    arlecchinoApplicationIconRectRatio ratio = arlecchinoFallbackApplicationIconBodyRatio();
    if (rendered) {
        arlecchinoMeasureApplicationIconBodyRatio(rep, &ratio);
    }
    [rep release];
    return ratio;
}

static NSImage* arlecchinoCopyApplicationIconResource(NSString *appearanceValue) {
    NSString *resourceName = nil;
    if ([appearanceValue isEqualToString:@"light"]) {
        resourceName = @"appicon-light";
    } else if ([appearanceValue isEqualToString:@"dark"]) {
        resourceName = @"appicon-dark";
    } else {
        return nil;
    }

    NSImage *source = nil;
    NSString *path = [[NSBundle mainBundle] pathForResource:resourceName ofType:@"png"];
    if (path != nil) {
        source = [[[NSImage alloc] initWithContentsOfFile:path] autorelease];
    }
    if (source == nil) {
        source = [[NSBundle mainBundle] imageForResource:resourceName];
    }
    if (source == nil) {
        return nil;
    }

    NSImage *systemIcon = arlecchinoSystemApplicationIcon();
    arlecchinoApplicationIconRepSpec specs[ARLECCHINO_MAX_APPLICATION_ICON_REPS];
    NSUInteger specCount = 0;
    arlecchinoCopyApplicationIconRepSpecs(systemIcon, specs, &specCount);
    arlecchinoApplicationIconRepSpec largestSpec = arlecchinoLargestApplicationIconRepSpec(specs, specCount);
    arlecchinoApplicationIconRectRatio bodyRatio = arlecchinoApplicationIconBodyRatio(systemIcon, largestSpec);

    NSImage *icon = [[NSImage alloc] initWithSize:arlecchinoApplicationIconImageSize(systemIcon)];
    [icon setTemplate:NO];
    for (NSUInteger index = 0; index < specCount; index++) {
        arlecchinoApplicationIconRepSpec spec = specs[index];
        NSBitmapImageRep *rep = arlecchinoCreateApplicationIconBitmapRep(spec);
        if (rep == nil) {
            continue;
        }

        NSRect targetRect = NSMakeRect(
            bodyRatio.x * spec.pointsWide,
            bodyRatio.y * spec.pointsHigh,
            bodyRatio.width * spec.pointsWide,
            bodyRatio.height * spec.pointsHigh
        );
        if (arlecchinoDrawApplicationIconImageInRep(source, rep, targetRect)) {
            [icon addRepresentation:rep];
        }
        [rep release];
    }

    if ([[icon representations] count] == 0) {
        [icon release];
        return nil;
    }

    return icon;
}

static bool arlecchinoSetApplicationIconAppearance(const char *appearanceCString) {
    NSString *appearanceValue = [[NSString alloc] initWithUTF8String:appearanceCString];
    if (appearanceValue == nil) {
        return false;
    }

    __block bool result = false;
    void (^apply)(void) = ^{
        if ([appearanceValue isEqualToString:@"system"]) {
            [NSApp setApplicationIconImage:nil];
            result = true;
            return;
        }

        if (![appearanceValue isEqualToString:@"light"] && ![appearanceValue isEqualToString:@"dark"]) {
            return;
        }

        NSImage *icon = arlecchinoCopyApplicationIconResource(appearanceValue);
        if (icon == nil) {
            return;
        }

        [NSApp setApplicationIconImage:icon];
        [icon release];
        result = true;
    };

    if ([NSThread isMainThread]) {
        apply();
    } else {
        dispatch_sync(dispatch_get_main_queue(), apply);
    }

    [appearanceValue release];
    return result;
}
*/
import "C"

import (
	"strings"
	"unsafe"
)

func (a *App) SetApplicationIconAppearance(appearance string) bool {
	normalized := strings.ToLower(strings.TrimSpace(appearance))
	switch normalized {
	case "system", "light", "dark":
	default:
		return false
	}

	cAppearance := C.CString(normalized)
	defer C.free(unsafe.Pointer(cAppearance))
	return bool(C.arlecchinoSetApplicationIconAppearance(cAppearance))
}
