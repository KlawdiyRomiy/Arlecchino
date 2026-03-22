package laravel

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type RouteIndexInfo struct {
	Name           string   `json:"name"`
	Method         string   `json:"method"`
	URI            string   `json:"uri"`
	Action         string   `json:"action"`
	Controller     string   `json:"controller"`
	Middleware     []string `json:"middleware"`
	FilePath       string   `json:"filePath"`
	LineNumber     int      `json:"lineNumber"`
	ControllerPath string   `json:"controllerPath"`
	ActionLine     int      `json:"actionLine"`
}

type RoutesIndexer struct {
	projectPath string
}

func NewRoutesIndexer(projectPath string) *RoutesIndexer {
	return &RoutesIndexer{projectPath: projectPath}
}

func (r *RoutesIndexer) Index() ([]RouteIndexInfo, error) {
	routes := []RouteIndexInfo{}
	routesDir := filepath.Join(r.projectPath, "routes")

	if _, err := os.Stat(routesDir); os.IsNotExist(err) {
		return routes, nil
	}

	err := filepath.Walk(routesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".php") {
			return err
		}

		fileRoutes, err := r.parseRoutesFile(path)
		if err == nil {
			routes = append(routes, fileRoutes...)
		}
		return nil
	})

	if err != nil {
		return routes, err
	}

	// Обогащаем маршруты путями к контроллерам и строками методов
	routes = r.EnrichWithControllerPaths(routes)

	return routes, nil
}

func (r *RoutesIndexer) parseRoutesFile(filePath string) ([]RouteIndexInfo, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	routes := []RouteIndexInfo{}
	scanner := bufio.NewScanner(file)
	lineNum := 0

	methodPattern := regexp.MustCompile(`Route::(get|post|put|patch|delete|options|any)\(['"]([^'"]+)['"](?:,\s*(.+))?\)`)
	namePattern := regexp.MustCompile(`->name\(['"]([^'"]+)['"]\)`)
	middlewarePattern := regexp.MustCompile(`->middleware\(\[?['"]([^'"]+)['"]`)
	controllerPattern := regexp.MustCompile(`\[(\w+Controller)::class,\s*['"](\w+)['"]\]`)
	resourcePattern := regexp.MustCompile(`Route::(resource|apiResource)\(['"]([^'"]+)['"]\s*,\s*(\w+Controller)::class\)`)

	var currentRoute *RouteIndexInfo
	var inGroup bool
	var groupMiddleware []string

	for scanner.Scan() {
		lineNum++
		line := strings.TrimSpace(scanner.Text())

		if strings.HasPrefix(line, "Route::group") {
			inGroup = true
			if mw := middlewarePattern.FindStringSubmatch(line); len(mw) > 1 {
				groupMiddleware = strings.Split(mw[1], ",")
			}
			continue
		}

		if inGroup && strings.Contains(line, "});") {
			inGroup = false
			groupMiddleware = []string{}
			continue
		}

		if matches := resourcePattern.FindStringSubmatch(line); len(matches) > 3 {
			resourceRoutes := r.expandResource(matches[1], matches[2], matches[3], filePath, lineNum)
			routes = append(routes, resourceRoutes...)
			continue
		}

		if matches := methodPattern.FindStringSubmatch(line); len(matches) > 2 {
			route := RouteIndexInfo{
				Method:     strings.ToUpper(matches[1]),
				URI:        matches[2],
				FilePath:   filePath,
				LineNumber: lineNum,
				Middleware: append([]string{}, groupMiddleware...),
			}

			if len(matches) > 3 && matches[3] != "" {
				action := strings.TrimSpace(matches[3])
				if ctrl := controllerPattern.FindStringSubmatch(action); len(ctrl) > 2 {
					route.Controller = ctrl[1]
					route.Action = ctrl[2]
				} else {
					route.Action = action
				}
			}

			currentRoute = &route
		}

		if currentRoute != nil {
			if name := namePattern.FindStringSubmatch(line); len(name) > 1 {
				currentRoute.Name = name[1]
			}

			if mw := middlewarePattern.FindStringSubmatch(line); len(mw) > 1 {
				currentRoute.Middleware = append(currentRoute.Middleware, mw[1])
			}

			if strings.Contains(line, ";") {
				routes = append(routes, *currentRoute)
				currentRoute = nil
			}
		}
	}

	return routes, nil
}

func (r *RoutesIndexer) expandResource(resourceType, name, controller string, filePath string, lineNum int) []RouteIndexInfo {
	routes := []RouteIndexInfo{}

	actions := map[string]string{
		"index":   "GET",
		"create":  "GET",
		"store":   "POST",
		"show":    "GET",
		"edit":    "GET",
		"update":  "PUT",
		"destroy": "DELETE",
	}

	if resourceType == "apiResource" {
		delete(actions, "create")
		delete(actions, "edit")
	}

	for action, method := range actions {
		uri := name
		if action == "show" || action == "edit" || action == "update" || action == "destroy" {
			uri = name + "/{id}"
		}
		if action == "create" {
			uri = name + "/create"
		}
		if action == "edit" {
			uri = name + "/{id}/edit"
		}

		routes = append(routes, RouteIndexInfo{
			Name:       name + "." + action,
			Method:     method,
			URI:        uri,
			Controller: controller,
			Action:     action,
			FilePath:   filePath,
			LineNumber: lineNum,
		})
	}

	return routes
}

func (r *RoutesIndexer) ExportJSON(routes []RouteIndexInfo) (string, error) {
	data, err := json.MarshalIndent(routes, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// EnrichWithControllerPaths добавляет пути к контроллерам и номера строк методов
func (r *RoutesIndexer) EnrichWithControllerPaths(routes []RouteIndexInfo) []RouteIndexInfo {
	controllerCache := make(map[string]string) // controller name -> path

	for i := range routes {
		if routes[i].Controller == "" {
			continue
		}

		// Ищем путь к контроллеру
		controllerPath, ok := controllerCache[routes[i].Controller]
		if !ok {
			controllerPath = r.findControllerPath(routes[i].Controller)
			controllerCache[routes[i].Controller] = controllerPath
		}

		routes[i].ControllerPath = controllerPath

		// Ищем строку метода
		if controllerPath != "" && routes[i].Action != "" {
			routes[i].ActionLine = r.findMethodLine(controllerPath, routes[i].Action)
		}
	}

	return routes
}

// findControllerPath ищет файл контроллера рекурсивно
func (r *RoutesIndexer) findControllerPath(controllerName string) string {
	controllersDir := filepath.Join(r.projectPath, "app", "Http", "Controllers")
	fileName := controllerName + ".php"

	var foundPath string
	filepath.Walk(controllersDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == fileName {
			foundPath = path
			return filepath.SkipAll // Нашли, прекращаем поиск
		}
		return nil
	})

	return foundPath
}

// findMethodLine ищет строку определения метода в файле
func (r *RoutesIndexer) findMethodLine(filePath, methodName string) int {
	file, err := os.Open(filePath)
	if err != nil {
		return 1
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineNum := 0

	// Паттерн для поиска метода: function methodName(
	methodPattern := regexp.MustCompile(`function\s+` + regexp.QuoteMeta(methodName) + `\s*\(`)

	for scanner.Scan() {
		lineNum++
		if methodPattern.MatchString(scanner.Text()) {
			return lineNum
		}
	}

	return 1 // Если не нашли, возвращаем 1
}
