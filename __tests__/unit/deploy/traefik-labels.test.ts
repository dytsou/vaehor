import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");

describe("deploy/traefik production stack", () => {
  const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
  const traefikConfig = readFileSync(
    resolve(root, "deploy/traefik/traefik.yml"),
    "utf8",
  );
  const middlewares = readFileSync(
    resolve(root, "deploy/traefik/dynamic/middlewares.yml"),
    "utf8",
  );

  it("replaces Caddy with Traefik in docker-compose", () => {
    expect(compose).toContain("traefik:");
    expect(compose).not.toMatch(/^\s*caddy:/m);
    expect(compose).not.toContain("caddy:alpine");
    expect(compose).not.toContain("caddy_data");
  });

  it("labels zee-index for Traefik routing and TLS", () => {
    expect(compose).toContain("traefik.enable=true");
    expect(compose).toContain("traefik.http.routers.zee-index.rule=Host");
    expect(compose).toContain(
      "traefik.http.routers.zee-index.entrypoints=websecure",
    );
    expect(compose).toContain("traefik.http.routers.zee-index.tls=true");
    expect(compose).toContain(
      "traefik.http.routers.zee-index.tls.certresolver=letsencrypt",
    );
    expect(compose).toContain(
      "traefik.http.services.zee-index.loadbalancer.server.port=3000",
    );
  });

  it("mounts Traefik config and ACME storage", () => {
    expect(compose).toContain("./deploy/traefik/traefik.yml:/traefik.yml:ro");
    expect(compose).toContain("./deploy/traefik/dynamic:/dynamic:ro");
    expect(compose).toContain("traefik_data:/letsencrypt");
    expect(compose).toContain("/var/run/docker.sock:/var/run/docker.sock:ro");
  });

  it("sets long readTimeout on the websecure entrypoint", () => {
    expect(traefikConfig).toContain("readTimeout: 3600s");
    expect(traefikConfig).toContain("websecure");
  });

  it("does not define buffering middleware", () => {
    expect(middlewares).not.toMatch(/^\s*buffering:/m);
    expect(compose).not.toContain("buffering");
  });
});
