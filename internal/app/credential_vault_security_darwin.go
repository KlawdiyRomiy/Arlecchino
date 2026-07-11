//go:build darwin && !arle_swift_bridge

package app

import (
	"errors"
	"fmt"
	"strings"

	"arlecchino/internal/keychain"
)

func credentialVaultFind(service string, account string) (string, error) {
	value, err := keychain.Find(service, account)
	if err != nil {
		if errors.Is(err, keychain.ErrNotFound) {
			return "", errAutoUpdateTokenNotFound
		}
		return "", fmt.Errorf("Keychain token lookup failed: %w", err)
	}
	return strings.TrimSpace(value), nil
}

func credentialVaultSave(service string, account string, value string) error {
	if err := keychain.Save(service, account, value); err != nil {
		return fmt.Errorf("Keychain token save failed: %w", err)
	}
	return nil
}

func credentialVaultDelete(service string, account string) error {
	if err := keychain.Delete(service, account); err != nil && !errors.Is(err, keychain.ErrNotFound) {
		return fmt.Errorf("Keychain token delete failed: %w", err)
	}
	return nil
}
