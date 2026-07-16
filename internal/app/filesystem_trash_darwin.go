//go:build darwin && cgo

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#include <stdlib.h>
#include <string.h>

static char* arlecchinoMoveProjectEntryToTrash(const char *path, char **resultPath) {
	@autoreleasepool {
		if (resultPath != NULL) {
			*resultPath = NULL;
		}
		if (path == NULL || path[0] == '\0') {
			return strdup("path is empty");
		}

		NSString *sourcePath = [NSString stringWithUTF8String:path];
		if (sourcePath == nil) {
			return strdup("path is not valid UTF-8");
		}

		NSURL *sourceURL = [NSURL fileURLWithPath:sourcePath];
		__block char *recycledPath = NULL;
		__block char *recycleError = NULL;
		dispatch_semaphore_t completion = dispatch_semaphore_create(0);

		// NSWorkspace documents this API as moving files to the Trash in the
		// same manner as Finder. It also requires an active dispatch queue for
		// its completion handler, so start it on a system-managed queue.
		dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
			[[NSWorkspace sharedWorkspace]
			recycleURLs:@[sourceURL]
			completionHandler:^(NSDictionary<NSURL *, NSURL *> *resultURLs, NSError *error) {
				if (error != nil) {
					NSString *message = [error localizedDescription];
					const char *utf8Message = [message UTF8String];
					recycleError = strdup(utf8Message != NULL ? utf8Message : "unknown error");
				} else {
					NSURL *resultURL = [resultURLs objectForKey:sourceURL];
					const char *resultUTF8 = [[resultURL path] UTF8String];
					if (resultUTF8 == NULL) {
						recycleError = strdup("macOS did not return the Trash destination");
					} else {
						recycledPath = strdup(resultUTF8);
					}
				}
				dispatch_semaphore_signal(completion);
			}];
		});
		dispatch_semaphore_wait(completion, DISPATCH_TIME_FOREVER);

		if (recycleError != NULL) {
			return recycleError;
		}
		if (resultPath == NULL || recycledPath == NULL) {
			free(recycledPath);
			return strdup("macOS did not return the Trash destination");
		}
		*resultPath = recycledPath;
		return NULL;
	}
}

static char* arlecchinoMoveProjectEntry(const char *source, const char *target) {
	@autoreleasepool {
		if (source == NULL || source[0] == '\0' || target == NULL || target[0] == '\0') {
			return strdup("source and target paths are required");
		}
		NSString *sourcePath = [NSString stringWithUTF8String:source];
		NSString *targetPath = [NSString stringWithUTF8String:target];
		if (sourcePath == nil || targetPath == nil) {
			return strdup("path is not valid UTF-8");
		}

		NSError *error = nil;
		BOOL didMove = [[NSFileManager defaultManager]
			moveItemAtURL:[NSURL fileURLWithPath:sourcePath]
			toURL:[NSURL fileURLWithPath:targetPath]
			error:&error];
		if (didMove) {
			return NULL;
		}

		NSString *message = error != nil ? [error localizedDescription] : @"unknown error";
		const char *utf8Message = [message UTF8String];
		return strdup(utf8Message != NULL ? utf8Message : "unknown error");
	}
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

func moveProjectEntryToTrashOnDarwinWithResult(path string) (string, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	var resultPath *C.char
	message := C.arlecchinoMoveProjectEntryToTrash(cPath, &resultPath)
	if message != nil {
		defer C.free(unsafe.Pointer(message))
		return "", fmt.Errorf("move to Trash failed: %s", C.GoString(message))
	}
	if resultPath == nil {
		return "", fmt.Errorf("move to Trash failed: macOS did not return the Trash destination")
	}
	defer C.free(unsafe.Pointer(resultPath))

	return C.GoString(resultPath), nil
}

func moveProjectEntryFromTrashOnDarwin(sourcePath string, targetPath string) error {
	cSourcePath := C.CString(sourcePath)
	defer C.free(unsafe.Pointer(cSourcePath))
	cTargetPath := C.CString(targetPath)
	defer C.free(unsafe.Pointer(cTargetPath))

	message := C.arlecchinoMoveProjectEntry(cSourcePath, cTargetPath)
	if message == nil {
		return nil
	}
	defer C.free(unsafe.Pointer(message))
	return fmt.Errorf("move project entry: %s", C.GoString(message))
}
