package core

import (
	"testing"
	"time"
)

func TestScheduler_EnqueueWakesIdleWorker(t *testing.T) {
	s := NewScheduler(1, nil)
	done := make(chan Job, 1)
	s.OnJobComplete(func(job Job, err error) {
		if err != nil {
			return
		}
		select {
		case done <- job:
		default:
		}
	})

	s.Start()
	defer s.Stop()

	warmup := Job{ProjectID: "warmup", Language: "missing", Priority: 0}
	s.Enqueue(warmup)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("warmup job did not complete")
	}

	job := Job{ProjectID: "scheduler-test", Language: "missing", Priority: 1}
	s.Enqueue(job)

	select {
	case got := <-done:
		if got.ProjectID != job.ProjectID {
			t.Fatalf("ProjectID = %q, want %q", got.ProjectID, job.ProjectID)
		}
	case <-time.After(20 * time.Millisecond):
		t.Fatal("idle worker did not wake within 20ms after enqueue")
	}
}
