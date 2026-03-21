package main

import (
	"arlecchino/internal/composer"
	"arlecchino/internal/plugins/laravel"
	"arlecchino/internal/project"
	"arlecchino/internal/system"
	"context"
	"encoding/json"
	"fmt"
	"os"
)

type App struct {
	ctx    context.Context
	exec   *laravel.SimpleExec
	cmp    *composer.ComposerManager
	sys    *system.SystemManager
	pm     *project.ProjectManager
	bridge *laravel.PHPBridge
}

func NewApp() *App {
	return &App{}
}

func (a *App) OpenProject(path string) error {
	exec, err := laravel.NewSimpleExec(path)
	if err != nil {
		return err
	}
	a.exec = exec

	cmp, err := composer.NewComposerManager(path)
	if err != nil {
		return err
	}
	a.cmp = cmp

	sys, err := system.NewSystemManager(path)
	if err != nil {
		return err
	}
	a.sys = sys

	bridge, err := laravel.NewPHPBridge(path)
	if err != nil {
		return err
	}
	a.bridge = bridge

	return nil
}

func (a *App) CloseProject() error {
	a.exec = nil
	a.cmp = nil
	a.sys = nil
	a.bridge = nil
	return nil
}

func (a *App) GetRouteList(filter string) (interface{}, error) {
	if a.bridge == nil {
		return nil, fmt.Errorf("no project opened")
	}
	return a.bridge.GetRouteList(filter)
}

func (a *App) AnalyzeModels(modelName string) (interface{}, error) {
	if a.bridge == nil {
		return nil, fmt.Errorf("no project opened")
	}
	return a.bridge.AnalyzeModels(modelName)
}

func (a *App) ExecuteQuery(query string, bindings []interface{}) (interface{}, error) {
	if a.bridge == nil {
		return nil, fmt.Errorf("no project opened")
	}
	return a.bridge.ExecuteQuery(query, bindings)
}

func main() {
	// Проверяем, что проект существует
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run test_bridge.go /Users/a1/Documents/test_arle_project")
		return
	}

	projectPath := os.Args[1]

	app := NewApp()
	fmt.Println("Opening Laravel project:", projectPath)

	err := app.OpenProject(projectPath)
	if err != nil {
		fmt.Printf("Error opening project: %v\n", err)
		return
	}
	defer app.CloseProject()

	fmt.Println("Testing route analysis...")
	routes, err := app.GetRouteList("")
	if err != nil {
		fmt.Printf("Error getting routes: %v\n", err)
	} else {
		fmt.Printf("Successfully retrieved routes: %+v\n", routes)

		// Если результат содержит маршруты, попробуем вывести JSON
		if routes != nil {
			jsonBytes, _ := json.MarshalIndent(routes, "", "  ")
			fmt.Printf("Routes JSON:\n%s\n", jsonBytes)
		}
	}

	fmt.Println("\nTesting model analysis...")
	models, err := app.AnalyzeModels("")
	if err != nil {
		fmt.Printf("Error analyzing models: %v\n", err)
	} else {
		fmt.Printf("Successfully analyzed models: %+v\n", models)

		if models != nil {
			jsonBytes, _ := json.MarshalIndent(models, "", "  ")
			fmt.Printf("Models JSON:\n%s\n", jsonBytes)
		}
	}

	fmt.Println("\nTesting query execution...")
	queryResult, err := app.ExecuteQuery("SELECT 1 as test", []interface{}{})
	if err != nil {
		fmt.Printf("Error executing query: %v\n", err)
	} else {
		fmt.Printf("Query executed successfully: %+v\n", queryResult)
	}

	fmt.Println("\nBridge testing completed!")
}
