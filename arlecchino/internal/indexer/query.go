package indexer

type QueryResult struct {
	Name      string
	Kind      string
	Namespace string
	FilePath  string
	Line      int
	Pending   bool
	Extra     map[string]string
}

type Query struct {
	store       *Store
	speculative *SpeculativeStore
	projectID   string
}

func NewQuery(store *Store, speculative *SpeculativeStore, projectID string) *Query {
	return &Query{
		store:       store,
		speculative: speculative,
		projectID:   projectID,
	}
}

func (q *Query) FindModel(name string) *QueryResult {
	if q.speculative != nil {
		if pending := q.speculative.FindByName(q.projectID, PendingModel, name); pending != nil {
			return &QueryResult{
				Name:      pending.Name,
				Kind:      "model",
				Namespace: pending.Namespace,
				FilePath:  pending.FilePath,
				Pending:   true,
			}
		}
	}

	if q.store == nil || q.store.db == nil {
		return nil
	}

	var rec ModelRecord
	if err := q.store.db.Where("project_id = ? AND name = ?", q.projectID, name).First(&rec).Error; err != nil {
		return nil
	}

	return &QueryResult{
		Name:      rec.Name,
		Kind:      "model",
		Namespace: rec.Namespace,
		FilePath:  rec.FilePath,
		Pending:   false,
	}
}

func (q *Query) FindController(name string) *QueryResult {
	if q.speculative != nil {
		if pending := q.speculative.FindByName(q.projectID, PendingController, name); pending != nil {
			return &QueryResult{
				Name:      pending.Name,
				Kind:      "controller",
				Namespace: pending.Namespace,
				FilePath:  pending.FilePath,
				Pending:   true,
			}
		}
	}

	if q.store == nil || q.store.db == nil {
		return nil
	}

	var rec ControllerRecord
	if err := q.store.db.Where("project_id = ? AND name = ?", q.projectID, name).First(&rec).Error; err != nil {
		return nil
	}

	return &QueryResult{
		Name:      rec.Name,
		Kind:      "controller",
		Namespace: rec.Namespace,
		FilePath:  rec.FilePath,
		Pending:   false,
	}
}

func (q *Query) FindClass(name string) *QueryResult {
	if result := q.FindModel(name); result != nil {
		return result
	}
	if result := q.FindController(name); result != nil {
		return result
	}

	kinds := []PendingKind{
		PendingPolicy, PendingRequest, PendingEvent, PendingListener,
		PendingJob, PendingMail, PendingNotification, PendingMiddleware,
		PendingComponent, PendingLivewire,
	}

	if q.speculative != nil {
		for _, kind := range kinds {
			if pending := q.speculative.FindByName(q.projectID, kind, name); pending != nil {
				return &QueryResult{
					Name:      pending.Name,
					Kind:      string(pending.Kind),
					Namespace: pending.Namespace,
					FilePath:  pending.FilePath,
					Pending:   true,
				}
			}
		}
	}

	return nil
}

func (q *Query) SearchClasses(prefix string) []QueryResult {
	var results []QueryResult

	if q.speculative != nil {
		for _, pending := range q.speculative.List(q.projectID) {
			if matchPrefix(pending.Name, prefix) {
				results = append(results, QueryResult{
					Name:      pending.Name,
					Kind:      string(pending.Kind),
					Namespace: pending.Namespace,
					FilePath:  pending.FilePath,
					Pending:   true,
				})
			}
		}
	}

	if q.store != nil && q.store.db != nil {
		var models []ModelRecord
		q.store.db.Where("project_id = ? AND name LIKE ?", q.projectID, prefix+"%").Find(&models)
		for _, m := range models {
			if !containsResult(results, m.Name, "model") {
				results = append(results, QueryResult{
					Name:      m.Name,
					Kind:      "model",
					Namespace: m.Namespace,
					FilePath:  m.FilePath,
					Pending:   false,
				})
			}
		}

		var controllers []ControllerRecord
		q.store.db.Where("project_id = ? AND name LIKE ?", q.projectID, prefix+"%").Find(&controllers)
		for _, c := range controllers {
			if !containsResult(results, c.Name, "controller") {
				results = append(results, QueryResult{
					Name:      c.Name,
					Kind:      "controller",
					Namespace: c.Namespace,
					FilePath:  c.FilePath,
					Pending:   false,
				})
			}
		}
	}

	return results
}

func (q *Query) FindRoute(uri, method string) *QueryResult {
	if q.store == nil || q.store.db == nil {
		return nil
	}

	var rec RouteRecord
	query := q.store.db.Where("project_id = ? AND uri = ?", q.projectID, uri)
	if method != "" {
		query = query.Where("method = ?", method)
	}
	if err := query.First(&rec).Error; err != nil {
		return nil
	}

	return &QueryResult{
		Name:     rec.Name,
		Kind:     "route",
		FilePath: rec.FilePath,
		Line:     rec.LineNumber,
		Extra: map[string]string{
			"method":     rec.Method,
			"uri":        rec.URI,
			"controller": rec.Controller,
			"action":     rec.Action,
		},
	}
}

func (q *Query) FindView(name string) *QueryResult {
	if q.store == nil || q.store.db == nil {
		return nil
	}

	var rec ViewRecord
	if err := q.store.db.Where("project_id = ? AND name = ?", q.projectID, name).First(&rec).Error; err != nil {
		return nil
	}

	return &QueryResult{
		Name:     rec.Name,
		Kind:     "view",
		FilePath: rec.Path,
	}
}

func matchPrefix(name, prefix string) bool {
	if prefix == "" {
		return true
	}
	return len(name) >= len(prefix) && name[:len(prefix)] == prefix
}

func (q *Query) GetAllControllers() []ControllerRecord {
	if q.store == nil || q.store.db == nil {
		return nil
	}

	var records []ControllerRecord
	q.store.db.Where("project_id = ?", q.projectID).Find(&records)
	return records
}

func containsResult(results []QueryResult, name, kind string) bool {
	for _, r := range results {
		if r.Name == name && r.Kind == kind {
			return true
		}
	}
	return false
}
