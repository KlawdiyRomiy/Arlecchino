package app

import "testing"

func TestNormalizeNativeContextMenuItems(t *testing.T) {
	items := normalizeNativeContextMenuItems([]NativeContextMenuItem{
		{Separator: true},
		{ID: "open", Label: " Open "},
		{ID: "hidden", Label: "Hidden", Hidden: true},
		{Separator: true},
		{Separator: true},
		{ID: "", Label: "Missing ID"},
		{ID: "missing-label", Label: " "},
		{ID: "copy", Label: "Copy Path", Disabled: true},
		{Separator: true},
	})

	want := []NativeContextMenuItem{
		{ID: "open", Label: "Open"},
		{Separator: true},
		{ID: "copy", Label: "Copy Path", Disabled: true},
	}
	if len(items) != len(want) {
		t.Fatalf("items length = %d, want %d: %#v", len(items), len(want), items)
	}
	for index := range want {
		if items[index] != want[index] {
			t.Fatalf("items[%d] = %#v, want %#v", index, items[index], want[index])
		}
	}
}

func TestOpenNativeContextMenuRequiresReadyApp(t *testing.T) {
	var app *App
	response, err := app.OpenNativeContextMenu(NativeContextMenuRequest{})
	if err != nil {
		t.Fatalf("OpenNativeContextMenu nil app error = %v", err)
	}
	if response.Opened {
		t.Fatalf("OpenNativeContextMenu nil app opened = true, want false")
	}
	if response.Reason == "" {
		t.Fatalf("OpenNativeContextMenu nil app should explain why it did not open")
	}
}
