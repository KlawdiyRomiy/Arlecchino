package predictive

import (
	"fmt"
	"testing"
)

func TestLocalVariablesInMethodBody(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	phpContent := []byte(`<?php

class UserService
{
    public function getName($userId, $format = 'string')
    {
        $user = $this->getUser($userId);
        $name = $user->name;
        $formatted = strtoupper($name);
        
        return $formatted;
    }
}
`)

	// Get completions at line 9 (inside method body)
	symbols := lc.GetCompletions("test.php", phpContent, 9, 10, "")

	found := make(map[string]string)
	for _, s := range symbols {
		found[s.Name] = s.Kind
		fmt.Printf("Found: %s (kind: %s, line: %d)\n", s.Name, s.Kind, s.Line)
	}

	// Check what we're missing
	missing := []string{"user", "name", "formatted", "userId", "format"}
	for _, varName := range missing {
		if _, ok := found[varName]; !ok {
			fmt.Printf("MISSING: %s\n", varName)
		}
	}
}

func TestMethodParameters(t *testing.T) {
	lc := NewLocalCompletions()
	defer lc.Close()

	phpContent := []byte(`<?php

class Calculator
{
    public function add($a, $b, $precision = 2)
    {
        return round($a + $b, $precision);
    }
}
`)

	symbols := lc.GetCompletions("test.php", phpContent, 6, 10, "")

	found := make(map[string]string)
	for _, s := range symbols {
		found[s.Name] = s.Kind
		fmt.Printf("Found: %s (kind: %s)\n", s.Name, s.Kind)
	}

	// Check for parameters
	params := []string{"a", "b", "precision"}
	for _, param := range params {
		if _, ok := found[param]; !ok {
			fmt.Printf("MISSING PARAMETER: %s\n", param)
		}
	}
}
