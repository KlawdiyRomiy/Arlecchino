//go:build darwin && !arle_swift_bridge

package ai

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>

static OSStatus arlFindGenericPassword(
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

static OSStatus arlAddOrUpdateGenericPassword(
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

static OSStatus arlDeleteGenericPassword(
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

static void arlFreePasswordContent(void* passwordData) {
	if (passwordData != NULL) {
		SecKeychainItemFreeContent(NULL, passwordData);
	}
}

static void arlReleaseItem(SecKeychainItemRef item) {
	if (item != NULL) {
		CFRelease(item);
	}
}
*/
import "C"

import (
	"context"
	"fmt"
	"strings"
	"unsafe"
)

type keychainSecretStore struct{}

func DefaultSecretStore() SecretStore {
	return keychainSecretStore{}
}

func (keychainSecretStore) FindSecret(ctx context.Context, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", ErrSecretNotFound
	}
	if err := ctxErr(ctx); err != nil {
		return "", err
	}
	service := []byte(keychainService)
	account := []byte(ref)
	var passwordLen C.UInt32
	var passwordData unsafe.Pointer
	var item C.SecKeychainItemRef
	status := C.arlFindGenericPassword(
		(*C.char)(unsafe.Pointer(&service[0])),
		C.UInt32(len(service)),
		(*C.char)(unsafe.Pointer(&account[0])),
		C.UInt32(len(account)),
		&passwordLen,
		&passwordData,
		&item,
	)
	C.arlReleaseItem(item)
	if status != C.errSecSuccess {
		return "", keychainStatusError("lookup", status)
	}
	defer C.arlFreePasswordContent(passwordData)
	value := string(C.GoBytes(passwordData, C.int(passwordLen)))
	if strings.TrimSpace(value) == "" {
		return "", ErrSecretNotFound
	}
	return value, nil
}

func (keychainSecretStore) SaveSecret(ctx context.Context, ref string, value string) error {
	ref = strings.TrimSpace(ref)
	value = strings.TrimSpace(value)
	if ref == "" || value == "" {
		return fmt.Errorf("secret ref and value are required")
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	service := []byte(keychainService)
	account := []byte(ref)
	password := []byte(value)
	status := C.arlAddOrUpdateGenericPassword(
		(*C.char)(unsafe.Pointer(&service[0])),
		C.UInt32(len(service)),
		(*C.char)(unsafe.Pointer(&account[0])),
		C.UInt32(len(account)),
		unsafe.Pointer(&password[0]),
		C.UInt32(len(password)),
	)
	if status != C.errSecSuccess {
		return keychainStatusError("save", status)
	}
	return nil
}

func (keychainSecretStore) ClearSecret(ctx context.Context, ref string) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	service := []byte(keychainService)
	account := []byte(ref)
	status := C.arlDeleteGenericPassword(
		(*C.char)(unsafe.Pointer(&service[0])),
		C.UInt32(len(service)),
		(*C.char)(unsafe.Pointer(&account[0])),
		C.UInt32(len(account)),
	)
	if status != C.errSecSuccess {
		return keychainStatusError("delete", status)
	}
	return nil
}

func keychainStatusError(operation string, status C.OSStatus) error {
	if status == C.errSecItemNotFound {
		return ErrSecretNotFound
	}
	return fmt.Errorf("keychain secret %s failed: OSStatus %d", operation, int(status))
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
