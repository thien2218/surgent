package main

import (
	"fmt"
	web "net/http"
	_ "embed"
)

const (
	Version = "1.0"
	maxRetries = 3
)

var low, high = 0, 10

var handle = func() {}

type ID = string

type Celsius float64

type Server struct {
	Name, Host string
	port       int
	*Config
	web.Handler
	inner struct{ depth int }
}

type List[T any] struct {
	items []T
}

type Store interface {
	fmt.Stringer
	Get(key string) string
}

func (s *Server) Start() error {
	ready := true
	_ = ready
	return nil
}

func (l *List[T]) Push(item T) {}

func NewServer() *Server {
	return &Server{}
}

func main() {
	run := func() {}
	run()
}

func nanotime() int64
