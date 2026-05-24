//go:build !darwin

package main

import "fmt"

func credentialVaultFind(string, string) (string, error) {
	return "", errAutoUpdateTokenNotFound
}

func credentialVaultSave(string, string, string) error {
	return fmt.Errorf("Keychain token storage is only available on macOS")
}

func credentialVaultDelete(string, string) error {
	return nil
}
