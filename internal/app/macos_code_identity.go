package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	macOSCodeIdentityAdhoc            = "adhoc"
	macOSCodeIdentityDeveloperID      = "developer-id"
	macOSCodeIdentityInvalid          = "invalid"
	macOSCodeIdentityLocalCertificate = "local-certificate"
	macOSCodeIdentityNotApplicable    = "not-applicable"
	macOSCodeIdentityUnknown          = "unknown"
	macOSCodeIdentityUnsigned         = "unsigned"
)

const (
	macOSPermissionStabilityInvalid             = "invalid"
	macOSPermissionStabilityLocalMachineStable  = "local-machine-stable"
	macOSPermissionStabilityNotApplicable       = "not-applicable"
	macOSPermissionStabilityPublicStable        = "public-stable"
	macOSPermissionStabilityUnstableAfterUpdate = "unstable-after-update"
)

type macOSCodeIdentity struct {
	BundleID                            string
	CodeIdentifier                      string
	Signature                           string
	CDHash                              string
	TeamIdentifier                      string
	Authorities                         []string
	DesignatedRequirement               string
	DesignatedRequirementIsCDHashOnly   bool
	IdentityKind                        string
	PermissionStability                 string
	StableRequirementFingerprint        string
	CodesignVerifyOutput                string
	CodesignDisplayOutput               string
	CodesignDesignatedRequirementOutput string
}

type macOSCodeIdentityInspector func(string) (macOSCodeIdentity, error)

func inspectMacOSAppCodeIdentity(appPath string) (macOSCodeIdentity, error) {
	if runtime.GOOS != "darwin" {
		return macOSCodeIdentity{
			IdentityKind:        macOSCodeIdentityNotApplicable,
			PermissionStability: macOSPermissionStabilityNotApplicable,
		}, nil
	}

	appPath = strings.TrimSpace(appPath)
	if appPath == "" {
		return macOSCodeIdentity{}, fmt.Errorf("app bundle path is required")
	}

	bundleID := readPlistRaw(filepath.Join(appPath, "Contents", "Info.plist"), "CFBundleIdentifier")
	verifyOutput, verifyErr := exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", appPath).CombinedOutput()
	displayOutput, displayErr := exec.Command("/usr/bin/codesign", "-dv", appPath).CombinedOutput()
	requirementOutput, requirementErr := exec.Command("/usr/bin/codesign", "-d", "-r-", appPath).CombinedOutput()

	identity := parseMacOSCodeIdentity(
		bundleID,
		verifyErr == nil,
		string(verifyOutput),
		string(displayOutput),
		string(requirementOutput),
	)
	if verifyErr != nil {
		return identity, fmt.Errorf("%w: %s", verifyErr, strings.TrimSpace(string(verifyOutput)))
	}
	if displayErr != nil {
		return identity, fmt.Errorf("codesign display failed: %w: %s", displayErr, strings.TrimSpace(string(displayOutput)))
	}
	if requirementErr != nil {
		return identity, fmt.Errorf("codesign designated requirement failed: %w: %s", requirementErr, strings.TrimSpace(string(requirementOutput)))
	}
	return identity, nil
}

func parseMacOSCodeIdentity(bundleID string, verified bool, verifyOutput string, displayOutput string, requirementOutput string) macOSCodeIdentity {
	identity := macOSCodeIdentity{
		BundleID:                            strings.TrimSpace(bundleID),
		CodeIdentifier:                      codesignLineValue(displayOutput, "Identifier"),
		Signature:                           codesignLineValue(displayOutput, "Signature"),
		CDHash:                              codesignLineValue(displayOutput, "CDHash"),
		TeamIdentifier:                      normalizeCodesignUnsetValue(codesignLineValue(displayOutput, "TeamIdentifier")),
		Authorities:                         codesignLineValues(displayOutput, "Authority"),
		DesignatedRequirement:               extractDesignatedRequirement(requirementOutput),
		CodesignVerifyOutput:                strings.TrimSpace(verifyOutput),
		CodesignDisplayOutput:               strings.TrimSpace(displayOutput),
		CodesignDesignatedRequirementOutput: strings.TrimSpace(requirementOutput),
	}
	if identity.BundleID == "" {
		identity.BundleID = identity.CodeIdentifier
	}
	identity.DesignatedRequirementIsCDHashOnly = isCDHashOnlyDesignatedRequirement(identity.DesignatedRequirement)
	identity.IdentityKind = inferMacOSCodeIdentityKind(identity, verified)
	identity.PermissionStability = permissionStabilityForMacOSCodeIdentity(identity.IdentityKind)
	if identity.DesignatedRequirement != "" {
		identity.StableRequirementFingerprint = fingerprintMacOSDesignatedRequirement(identity.DesignatedRequirement)
	}
	return identity
}

func codesignLineValue(output string, key string) string {
	values := codesignLineValues(output, key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func codesignLineValues(output string, key string) []string {
	prefix := key + "="
	var values []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, prefix) {
			values = append(values, strings.TrimSpace(strings.TrimPrefix(line, prefix)))
		}
	}
	return values
}

func normalizeCodesignUnsetValue(value string) string {
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, "not set") {
		return ""
	}
	return value
}

func extractDesignatedRequirement(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "designated =>") {
			return line
		}
	}
	return strings.TrimSpace(output)
}

func isCDHashOnlyDesignatedRequirement(requirement string) bool {
	requirement = strings.TrimSpace(requirement)
	requirement = strings.TrimPrefix(requirement, "#")
	requirement = strings.TrimSpace(requirement)
	return strings.HasPrefix(requirement, "designated => cdhash ")
}

func inferMacOSCodeIdentityKind(identity macOSCodeIdentity, verified bool) string {
	if !verified {
		if strings.Contains(identity.CodesignVerifyOutput, "not signed") ||
			strings.Contains(identity.CodesignDisplayOutput, "not signed") ||
			strings.Contains(identity.CodesignDesignatedRequirementOutput, "not signed") {
			return macOSCodeIdentityUnsigned
		}
		return macOSCodeIdentityInvalid
	}
	if strings.EqualFold(identity.Signature, "adhoc") || identity.DesignatedRequirementIsCDHashOnly {
		return macOSCodeIdentityAdhoc
	}
	for _, authority := range identity.Authorities {
		if strings.Contains(authority, "Developer ID Application:") {
			return macOSCodeIdentityDeveloperID
		}
	}
	if len(identity.Authorities) > 0 {
		return macOSCodeIdentityLocalCertificate
	}
	if identity.Signature == "" {
		return macOSCodeIdentityUnsigned
	}
	return macOSCodeIdentityUnknown
}

func permissionStabilityForMacOSCodeIdentity(identityKind string) string {
	switch identityKind {
	case macOSCodeIdentityDeveloperID:
		return macOSPermissionStabilityPublicStable
	case macOSCodeIdentityLocalCertificate:
		return macOSPermissionStabilityLocalMachineStable
	case macOSCodeIdentityNotApplicable:
		return macOSPermissionStabilityNotApplicable
	case macOSCodeIdentityInvalid:
		return macOSPermissionStabilityInvalid
	default:
		return macOSPermissionStabilityUnstableAfterUpdate
	}
}

func isPermissionStableMacOSCodeIdentity(identity macOSCodeIdentity) bool {
	if identity.DesignatedRequirementIsCDHashOnly || identity.StableRequirementFingerprint == "" {
		return false
	}
	return identity.IdentityKind == macOSCodeIdentityDeveloperID ||
		identity.IdentityKind == macOSCodeIdentityLocalCertificate
}

func fingerprintMacOSDesignatedRequirement(requirement string) string {
	requirement = strings.TrimSpace(requirement)
	if requirement == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(requirement))
	return hex.EncodeToString(sum[:])
}

func verifyPermissionStableMacOSUpdateCandidate(appPath string, inspect macOSCodeIdentityInspector) (macOSCodeIdentity, error) {
	if inspect == nil {
		return macOSCodeIdentity{}, nil
	}
	identity, err := inspect(appPath)
	if err != nil {
		return identity, err
	}
	if identity.IdentityKind == macOSCodeIdentityNotApplicable {
		return identity, nil
	}
	if !isPermissionStableMacOSCodeIdentity(identity) {
		return identity, fmt.Errorf("identityKind=%s permissionStability=%s cdhashOnly=%t",
			identity.IdentityKind,
			identity.PermissionStability,
			identity.DesignatedRequirementIsCDHashOnly,
		)
	}
	return identity, nil
}

func validateAutoUpdateCodeIdentityTransition(currentAppPath string, stagedAppPath string, inspect macOSCodeIdentityInspector) (macOSCodeIdentity, string, error) {
	if inspect == nil {
		return macOSCodeIdentity{}, "", nil
	}
	currentIdentity, err := inspect(currentAppPath)
	if err != nil {
		return macOSCodeIdentity{}, "", fmt.Errorf("current Arlecchino.app macOS code identity could not be inspected: %w", err)
	}
	stagedIdentity, err := verifyPermissionStableMacOSUpdateCandidate(stagedAppPath, inspect)
	if err != nil {
		return stagedIdentity, "", fmt.Errorf("staged Arlecchino.app macOS code identity is not permission-stable: %w", err)
	}
	if stagedIdentity.IdentityKind == macOSCodeIdentityNotApplicable {
		return stagedIdentity, "", nil
	}
	if currentIdentity.BundleID == "" || stagedIdentity.BundleID == "" || currentIdentity.BundleID != stagedIdentity.BundleID {
		return stagedIdentity, "", fmt.Errorf("staged Arlecchino.app bundle id %q does not match current app bundle id %q", stagedIdentity.BundleID, currentIdentity.BundleID)
	}

	if isPermissionStableMacOSCodeIdentity(currentIdentity) {
		if currentIdentity.StableRequirementFingerprint == "" ||
			currentIdentity.StableRequirementFingerprint != stagedIdentity.StableRequirementFingerprint {
			return stagedIdentity, "", fmt.Errorf("staged Arlecchino.app uses a different macOS signing identity; refusing update to avoid resetting folder permissions")
		}
		return stagedIdentity, "", nil
	}

	if currentIdentity.IdentityKind == macOSCodeIdentityAdhoc && isPermissionStableMacOSCodeIdentity(stagedIdentity) {
		return stagedIdentity, "This update migrates Arlecchino to a stable macOS signing identity. macOS may ask for folder access one final time after relaunch.", nil
	}

	return stagedIdentity, "", fmt.Errorf("current Arlecchino.app identityKind=%s cannot be safely migrated by automatic update", currentIdentity.IdentityKind)
}
