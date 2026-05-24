//go:build darwin && arle_swift_bridge

package ai

/*
#cgo LDFLAGS: -L/tmp/Arlecchino-wails-build/native/macos -larlecchino_native -framework AppKit -framework Foundation -framework Security -framework UserNotifications
#include <stdlib.h>

char* ArleNativeCall(const char* operation, const char* json);
void ArleNativeFree(char* value);
*/
import "C"

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unsafe"
)

type swiftKeychainSecretStore struct{}

type swiftCredentialResponse struct {
	OK       bool   `json:"ok"`
	Value    string `json:"value,omitempty"`
	NotFound bool   `json:"notFound,omitempty"`
	Error    string `json:"error,omitempty"`
}

func DefaultSecretStore() SecretStore {
	return swiftKeychainSecretStore{}
}

func (swiftKeychainSecretStore) FindSecret(ctx context.Context, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", ErrSecretNotFound
	}
	if err := ctxErr(ctx); err != nil {
		return "", err
	}
	response, err := swiftCredentialCall("credential.find", map[string]any{
		"service": keychainService,
		"account": ref,
	})
	if err != nil {
		if response.NotFound {
			return "", ErrSecretNotFound
		}
		return "", err
	}
	if response.NotFound || strings.TrimSpace(response.Value) == "" {
		return "", ErrSecretNotFound
	}
	return strings.TrimSpace(response.Value), nil
}

func (swiftKeychainSecretStore) SaveSecret(ctx context.Context, ref string, value string) error {
	ref = strings.TrimSpace(ref)
	value = strings.TrimSpace(value)
	if ref == "" || value == "" {
		return fmt.Errorf("secret ref and value are required")
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	_, err := swiftCredentialCall("credential.save", map[string]any{
		"service": keychainService,
		"account": ref,
		"value":   value,
	})
	return err
}

func (swiftKeychainSecretStore) ClearSecret(ctx context.Context, ref string) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	_, err := swiftCredentialCall("credential.delete", map[string]any{
		"service": keychainService,
		"account": ref,
	})
	return err
}

func swiftCredentialCall(operation string, payload map[string]any) (swiftCredentialResponse, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return swiftCredentialResponse{}, err
	}
	cOperation := C.CString(operation)
	cPayload := C.CString(string(data))
	defer C.free(unsafe.Pointer(cOperation))
	defer C.free(unsafe.Pointer(cPayload))

	result := C.ArleNativeCall(cOperation, cPayload)
	if result == nil {
		return swiftCredentialResponse{}, fmt.Errorf("Keychain secret %s failed: no native response", operation)
	}
	defer C.ArleNativeFree(result)

	var response swiftCredentialResponse
	if err := json.Unmarshal([]byte(C.GoString(result)), &response); err != nil {
		return swiftCredentialResponse{}, err
	}
	if !response.OK && response.Error != "" {
		return response, fmt.Errorf("Keychain secret %s failed: %s", operation, response.Error)
	}
	return response, nil
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
