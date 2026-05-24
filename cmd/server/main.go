package main

import (
	"log"
	"os"

	"lanmeeting/internal/app"
)

func main() {
	addr := os.Getenv("LANMEETING_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	server := app.NewServer(addr)
	log.Printf("lan meeting server listening on %s", addr)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
