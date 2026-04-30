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

func TestScheduler_StatsExposeAdaptivePolicy(t *testing.T) {
	s := NewScheduler(2, nil)
	s.SetPolicy(ConstrainedSchedulerPolicy())
	s.Enqueue(Job{ProjectID: "background", Priority: 5})

	stats := s.Stats()
	if stats.Pending != 1 {
		t.Fatalf("Pending = %d, want 1", stats.Pending)
	}
	if stats.Workers != 2 {
		t.Fatalf("Workers = %d, want 2", stats.Workers)
	}
	if stats.Mode != SchedulerModeConstrained {
		t.Fatalf("Mode = %q, want %q", stats.Mode, SchedulerModeConstrained)
	}
	if stats.BackgroundJobDelayMs <= 0 {
		t.Fatalf("BackgroundJobDelayMs = %d, want > 0", stats.BackgroundJobDelayMs)
	}
}

func TestScheduler_DequeuePrioritizesForegroundJobs(t *testing.T) {
	s := NewScheduler(1, nil)
	s.Enqueue(Job{ProjectID: "background", Priority: 5})
	s.Enqueue(Job{ProjectID: "foreground", Priority: 10})

	job, ok := s.dequeue()
	if !ok {
		t.Fatal("expected queued job")
	}
	if job.ProjectID != "foreground" {
		t.Fatalf("first job = %q, want foreground", job.ProjectID)
	}
}
