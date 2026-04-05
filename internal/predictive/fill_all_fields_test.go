package predictive

import (
	"strings"
	"testing"
)

func TestGetFillSuggestions_BasicLanguages(t *testing.T) {
	tests := []struct {
		name       string
		language   string
		content    string
		expected   string
		shouldHave bool
	}{
		{
			name:     "go function call",
			language: "go",
			content: `package main

func consume(name string, count int) {}

func test() {
	name := "alice"
	count := 5
	consume(|)
}`,
			expected:   "name, count",
			shouldHave: true,
		},
		{
			name:     "php function call",
			language: "php",
			content: `<?php

function createUser(string $name, int $age) {}

function test(): void {
	$name = "alice";
	$age = 30;
	createUser(|);
}`,
			expected:   "$name, $age",
			shouldHave: true,
		},
		{
			name:     "typescript function call",
			language: "typescript",
			content: `type User = { id: number }

function updateUser(user: User, count: number): void {}

function test(): void {
	const user: User = { id: 1 };
	const count = 2;
	updateUser(|);
}`,
			expected:   "user, count",
			shouldHave: true,
		},
		{
			name:     "python function call",
			language: "python",
			content: `def save_user(user: str, age: int):
	return

def test():
	user = "alice"
	age = 40
	save_user(|)
`,
			expected:   "user, age",
			shouldHave: true,
		},
		{
			name:     "unsupported language",
			language: "rust",
			content: `fn test() {
	foo(|)
}`,
			shouldHave: false,
		},
		{
			name:     "cursor not inside call",
			language: "go",
			content: `package main

func consume(name string) {}

func test() {
	name := "x"
	var x = |
	_ = x
	_ = name
}`,
			shouldHave: false,
		},
		{
			name:     "call already has first argument",
			language: "go",
			content: `package main

func consume(name string, count int) {}

func test() {
	name := "alice"
	count := 5
	consume(name, |)
}`,
			shouldHave: false,
		},
		{
			name:     "call already has expression argument",
			language: "typescript",
			content: `function updateUser(user: string, count: number): void {}

function test(): void {
	const user = "alice";
	const count = 2;
	updateUser(user.trim(), |);
}`,
			shouldHave: false,
		},
	}

	fill := NewFillAllFields()
	defer fill.Close()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			content, line, column := removeCursorMarker(tt.content)
			suggestions := fill.GetFillSuggestions("test", content, line, column, tt.language)

			if !tt.shouldHave {
				if len(suggestions) != 0 {
					t.Fatalf("expected no suggestions, got %d", len(suggestions))
				}
				return
			}

			if len(suggestions) == 0 {
				t.Fatalf("expected suggestions, got none")
			}

			if suggestions[0].InsertText != tt.expected {
				t.Fatalf("unexpected insert text: got %q want %q", suggestions[0].InsertText, tt.expected)
			}
		})
	}
}

func removeCursorMarker(input string) ([]byte, int, int) {
	idx := strings.Index(input, "|")
	if idx < 0 {
		panic("cursor marker not found")
	}

	before := input[:idx]
	line := strings.Count(before, "\n") + 1
	lastNewline := strings.LastIndex(before, "\n")
	column := idx
	if lastNewline >= 0 {
		column = idx - lastNewline - 1
	}

	clean := input[:idx] + input[idx+1:]
	return []byte(clean), line, column
}
