package main

import (
	"embed"

	"arlecchino/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app.Run(assets)
}
