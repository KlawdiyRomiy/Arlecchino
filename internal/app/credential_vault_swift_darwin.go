//go:build darwin && arle_swift_bridge

package app

import (
	"fmt"
	"strings"
)

func credentialVaultFind(service string, account string) (string, error) {
	service = strings.TrimSpace(service)
	account = strings.TrimSpace(account)
	if service == "" || account == "" {
		return "", errAutoUpdateTokenNotFound
	}
	response, err := callNativeMacOSBridge("credential.find", map[string]any{
		"service": service,
		"account": account,
	})
	if err != nil {
		if response.NotFound {
			return "", errAutoUpdateTokenNotFound
		}
		return "", fmt.Errorf("Keychain token lookup failed: %w", err)
	}
	if response.NotFound || strings.TrimSpace(response.Value) == "" {
		return "", errAutoUpdateTokenNotFound
	}
	return strings.TrimSpace(response.Value), nil
}

func credentialVaultSave(service string, account string, value string) error {
	service = strings.TrimSpace(service)
	account = strings.TrimSpace(account)
	value = strings.TrimSpace(value)
	if service == "" || account == "" || value == "" {
		return fmt.Errorf("Keychain service, account, and token are required")
	}
	if _, err := callNativeMacOSBridge("credential.save", map[string]any{
		"service": service,
		"account": account,
		"value":   value,
	}); err != nil {
		return fmt.Errorf("Keychain token save failed: %w", err)
	}
	return nil
}

func credentialVaultDelete(service string, account string) error {
	service = strings.TrimSpace(service)
	account = strings.TrimSpace(account)
	if service == "" || account == "" {
		return nil
	}
	if _, err := callNativeMacOSBridge("credential.delete", map[string]any{
		"service": service,
		"account": account,
	}); err != nil {
		return fmt.Errorf("Keychain token delete failed: %w", err)
	}
	return nil
}
