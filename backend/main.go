package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"github.com/labstack/echo/v4"
	"io"
	"log"
	_ "modernc.org/sqlite"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func startWorld(ctx context.Context, root, data string) (*url.URL, string, func(), error) {
	secret := random(32)
	cmd := exec.CommandContext(ctx, "node", filepath.Join(root, "backend", "world", "server.ts"))
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "ABWORLD_DATA_DIR="+data, "ABWORLD_WORKER_SECRET="+secret)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, "", nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, "", nil, err
	}
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		return nil, "", nil, err
	}
	reader := bufio.NewReader(out)
	line, err := reader.ReadString('\n')
	port, parseErr := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || parseErr != nil || port < 1 || port > 65535 {
		cmd.Process.Kill()
		cmd.Wait()
		return nil, "", nil, errors.New("world worker failed to start")
	}
	go io.Copy(io.Discard, reader)
	done := make(chan struct{})
	go func() { cmd.Wait(); close(done) }()
	u, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
	return u, secret, func() {
		in.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			cmd.Process.Kill()
			<-done
		}
	}, nil
}
func trustedLocal(r *http.Request) bool {
	local, _, _ := net.SplitHostPort(r.RemoteAddr)
	allowed := net.ParseIP(local).IsLoopback()
	frontKey := os.Getenv("ABWORLD_FRONT_SECRET")
	if r.Header.Get("X-World-Front") != "" {
		allowed = allowed && frontKey != "" && subtle.ConstantTimeCompare([]byte(frontKey), []byte(r.Header.Get("X-World-Front"))) == 1 && r.Header.Get("X-World-Front-Local") == "1"
	}
	return allowed
}
func run() error {
	root := env("ABWORLD_ROOT", "")
	if root == "" {
		root, _ = os.Getwd()
		if filepath.Base(root) == "backend" {
			root = filepath.Dir(root)
		}
	}
	root, _ = filepath.Abs(root)
	dir, _ := filepath.Abs(env("ABWORLD_DATA_DIR", filepath.Join(root, ".world")))
	if os.Getenv("ABWORLD_FRONT_SECRET") == "" {
		cache := filepath.Join(root, ".dev")
		if e := os.MkdirAll(cache, 0700); e != nil {
			return e
		}
		file := filepath.Join(cache, "proxy.key")
		f, e := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e == nil {
			_, e = f.WriteString(random(32))
			f.Close()
			if e != nil {
				return e
			}
		} else if !os.IsExist(e) {
			return e
		}
		key, e := os.ReadFile(file)
		if e != nil {
			return e
		}
		if len(key) != 64 {
			return errors.New("invalid local frontend handshake")
		}
		os.Setenv("ABWORLD_FRONT_SECRET", string(key))
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	db, err := sql.Open("sqlite", filepath.ToSlash(filepath.Join(dir, "accounts.sqlite"))+"?_pragma=busy_timeout%285000%29")
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,progress TEXT,revision INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL)`)
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	dest, key, closeWorld, err := startWorld(ctx, root, dir)
	if err != nil {
		return err
	}
	defer closeWorld()
	if os.Getenv("ABWORLD_PARENT_STDIN") == "1" {
		go func() { io.Copy(io.Discard, os.Stdin); cancel() }()
	}
	a := &api{db: db, tries: map[string]attempt{}}
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Server.ReadHeaderTimeout = 10 * time.Second
	e.HTTPErrorHandler = func(err error, c echo.Context) {
		if c.Response().Committed {
			return
		}
		code := 500
		var h *echo.HTTPError
		if errors.As(err, &h) {
			code = h.Code
		}
		fail(c, code, "服务请求未完成")
	}
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			r := c.Request()
			c.Response().Header().Set("Cache-Control", "no-store")
			if r.Method == "POST" {
				origin := r.Header.Get("Origin")
				if origin != "" {
					u, err := url.Parse(origin)
					if err != nil || u.Host != r.Host {
						return fail(c, 403, "请求来源无效")
					}
				}
				if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
					return fail(c, 415, "需要 JSON 请求")
				}
				r.Body = http.MaxBytesReader(c.Response(), r.Body, 65536)
			}
			return next(c)
		}
	})
	e.GET("/api/health", func(c echo.Context) error {
		return c.JSON(200, map[string]any{"service": "abworld", "backend": "go-echo", "world": true})
	})
	e.Match([]string{"GET", "POST"}, "/api/auth/:action", a.auth)
	protected := e.Group("/api")
	protected.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			u, err := a.current(c)
			if err != nil {
				return fail(c, 401, "请先登录")
			}
			c.Set("user", u)
			return next(c)
		}
	})
	world := &liveWorld{peers: map[int]*livePeer{}}
	protected.GET("/world/online", func(c echo.Context) error { return world.serve(a, c) })
	protected.GET("/world/time", func(c echo.Context) error {
		return c.JSON(200, map[string]any{"epoch": time.Now().UnixMilli(), "rate": 1})
	})
	proxy := httputil.NewSingleHostReverseProxy(dest)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(503)
		io.WriteString(w, `{"error":"世界计算服务暂不可用"}`)
	}
	forward := func(c echo.Context) error {
		r := c.Request()
		u := c.Get("user").(user)
		allowed := trustedLocal(r)
		for _, h := range []string{"X-World-Internal", "X-World-Uid", "X-World-Account", "X-World-Local", "X-World-Front", "X-World-Front-Local", "X-Forwarded-For", "Cookie"} {
			r.Header.Del(h)
		}
		r.Header.Set("X-World-Internal", key)
		r.Header.Set("X-World-Uid", strconv.Itoa(u.ID))
		r.Header.Set("X-World-Account", url.QueryEscape(u.Name))
		if allowed {
			r.Header.Set("X-World-Local", "1")
		}
		proxy.ServeHTTP(c.Response(), r)
		return nil
	}
	protected.Match([]string{"GET", "POST"}, "/civic/*", forward)
	protected.POST("/model/go/chat", a.modelChat)
	protected.GET("/civic/homes", a.houses)
	protected.GET("/world/objects", forward)
	addr := env("ABWORLD_API_ADDR", "127.0.0.1:8787")
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	e.Listener = ln
	fmt.Printf("ABWORLD_API_READY http://%s\n", ln.Addr())
	go func() {
		<-ctx.Done()
		end, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		e.Shutdown(end)
	}()
	err = e.Start(addr)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
func main() {
	if e := run(); e != nil {
		log.Fatal(e)
	}
}
