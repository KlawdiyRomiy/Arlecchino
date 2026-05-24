//go:build darwin && !arle_swift_bridge

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

func credentialVaultFind(service string, account string) (string, error) {
	output, err := exec.Command(
		"/usr/bin/security",
		"find-generic-password",
		"-w",
		"-s", strings.TrimSpace(service),
		"-a", strings.TrimSpace(account),
	).CombinedOutput()
	if err != nil {
		if strings.Contains(strings.ToLower(string(output)), "could not be found") {
			return "", errAutoUpdateTokenNotFound
		}
		return "", fmt.Errorf("Keychain token lookup failed: %s", strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func credentialVaultSave(service string, account string, value string) error {
	output, err := exec.Command(
		"/usr/bin/security",
		"add-generic-password",
		"-U",
		"-s", strings.TrimSpace(service),
		"-a", strings.TrimSpace(account),
		"-w", strings.TrimSpace(value),
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("Keychain token save failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func credentialVaultDelete(service string, account string) error {
	output, err := exec.Command(
		"/usr/bin/security",
		"delete-generic-password",
		"-s", strings.TrimSpace(service),
		"-a", strings.TrimSpace(account),
	).CombinedOutput()
	if err != nil && !strings.Contains(strings.ToLower(string(output)), "could not be found") {
		return fmt.Errorf("Keychain token delete failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}
