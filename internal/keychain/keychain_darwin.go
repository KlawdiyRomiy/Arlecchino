//go:build darwin && !arle_swift_bridge

package keychain

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>

static OSStatus arlKeychainFindGenericPassword(
	const char* service,
	UInt32 serviceLen,
	const char* account,
	UInt32 accountLen,
	UInt32* passwordLen,
	void** passwordData,
	SecKeychainItemRef* item
) {
	return SecKeychainFindGenericPassword(NULL, serviceLen, service, accountLen, account, passwordLen, passwordData, item);
}

static OSStatus arlKeychainAddOrUpdateGenericPassword(
	const char* service,
	UInt32 serviceLen,
	const char* account,
	UInt32 accountLen,
	const void* password,
	UInt32 passwordLen
) {
	SecKeychainItemRef item = NULL;
	OSStatus status = SecKeychainFindGenericPassword(NULL, serviceLen, service, accountLen, account, NULL, NULL, &item);
	if (status == errSecSuccess && item != NULL) {
		OSStatus updateStatus = SecKeychainItemModifyAttributesAndData(item, NULL, passwordLen, password);
		CFRelease(item);
		return updateStatus;
	}
	if (status != errSecItemNotFound) {
		return status;
	}
	return SecKeychainAddGenericPassword(NULL, serviceLen, service, accountLen, account, passwordLen, password, NULL);
}

static OSStatus arlKeychainDeleteGenericPassword(
	const char* service,
	UInt32 serviceLen,
	const char* account,
	UInt32 accountLen
) {
	SecKeychainItemRef item = NULL;
	OSStatus status = SecKeychainFindGenericPassword(NULL, serviceLen, service, accountLen, account, NULL, NULL, &item);
	if (status == errSecItemNotFound) {
		return errSecSuccess;
	}
	if (status != errSecSuccess) {
		return status;
	}
	status = SecKeychainItemDelete(item);
	CFRelease(item);
	return status;
}

static void arlKeychainFreePasswordContent(void* passwordData) {
	if (passwordData != NULL) {
		SecKeychainItemFreeContent(NULL, passwordData);
	}
}

static void arlKeychainReleaseItem(SecKeychainItemRef item) {
	if (item != NULL) {
		CFRelease(item);
	}
}
*/
import "C"

import (
	"errors"
	"fmt"
	"strings"
	"unsafe"
)

var ErrNotFound = errors.New("keychain item not found")

func Find(service string, account string) (string, error) {
	service = strings.TrimSpace(service)
	account = strings.TrimSpace(account)
	if service == "" || account == "" {
		return "", ErrNotFound
	}

	serviceBytes := []byte(service)
	accountBytes := []byte(account)
	var passwordLen C.UInt32
	var passwordData unsafe.Pointer
	var item C.SecKeychainItemRef
	status := C.arlKeychainFindGenericPassword(
		(*C.char)(unsafe.Pointer(&serviceBytes[0])),
		C.UInt32(len(serviceBytes)),
		(*C.char)(unsafe.Pointer(&accountBytes[0])),
		C.UInt32(len(accountBytes)),
		&passwordLen,
		&passwordData,
		&item,
	)
	C.arlKeychainReleaseItem(item)
	if status != C.errSecSuccess {
		return "", statusError("lookup", status)
	}
	defer C.arlKeychainFreePasswordContent(passwordData)
	value := string(C.GoBytes(passwordData, C.int(passwordLen)))
	if strings.TrimSpace(value) == "" {
		return "", ErrNotFound
	}
	return value, nil
}

func Save(service string, account string, value string) error {
	service = strings.TrimSpace(service)
	account = strings.TrimSpace(account)
	if service == "" || account == "" || strings.TrimSpace(value) == "" {
		return fmt.Errorf("keychain service, account, and value are required")
	}

	serviceBytes := []byte(service)
	accountBytes := []byte(account)
	passwordBytes := []byte(value)
	status := C.arlKeychainAddOrUpdateGenericPassword(
		(*C.char)(unsafe.Pointer(&serviceBytes[0])),
		C.UInt32(len(serviceBytes)),
		(*C.char)(unsafe.Pointer(&accountBytes[0])),
		C.UInt32(len(accountBytes)),
		unsafe.Pointer(&passwordBytes[0]),
		C.UInt32(len(passwordBytes)),
	)
	if status != C.errSecSuccess {
		return statusError("save", status)
	}
	return nil
}

func Delete(service string, account string) error {
	service = strings.TrimSpace(service)
	account = strings.TrimSpace(account)
	if service == "" || account == "" {
		return nil
	}

	serviceBytes := []byte(service)
	accountBytes := []byte(account)
	status := C.arlKeychainDeleteGenericPassword(
		(*C.char)(unsafe.Pointer(&serviceBytes[0])),
		C.UInt32(len(serviceBytes)),
		(*C.char)(unsafe.Pointer(&accountBytes[0])),
		C.UInt32(len(accountBytes)),
	)
	if status != C.errSecSuccess {
		return statusError("delete", status)
	}
	return nil
}

func statusError(operation string, status C.OSStatus) error {
	if status == C.errSecItemNotFound {
		return ErrNotFound
	}
	return fmt.Errorf("keychain %s failed: OSStatus %d", operation, int(status))
}
