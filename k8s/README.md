# Kubernetes manifests

Plain manifests (no Helm/Kustomize) for running StoreTrack. Both deploy
pipelines — GitHub Actions (`../.github/workflows/ci-cd.yml`) and Jenkins
(`../Jenkinsfile`) — only run `kubectl set image` + `rollout status` against
an already-existing Deployment, so these need to be applied once up front
(and again whenever non-image fields change).

## Prerequisites

- An EKS (or any) cluster. `../infra/eksctl-cluster.yaml` provisions a single
  cost-minimized `t3.small` node with no NAT Gateway.
- `metrics-server` installed (required for the HPA's CPU/memory metrics) —
  not included in `eksctl-cluster.yaml`'s addons, so install it separately.
- A `storetrack-secrets` Secret populated out-of-band (see below) — there is
  no `secret.yaml` template committed here, intentionally, since it would
  otherwise invite placeholder values to get applied for real.

`ingress.yaml` is **not currently used** — there's no ingress controller,
domain, or TLS cert set up on the target cluster. `service.yaml` is a
`NodePort` instead, reachable at `http://<node-public-ip>:30080`. Keep
`ingress.yaml` unapplied until there's a real hostname and an ingress
controller installed; at that point switch `service.yaml` back to
`ClusterIP` and apply `ingress.yaml` in its place.

## Apply order

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml

kubectl create secret generic storetrack-secrets \
  --namespace storetrack \
  --from-literal=MONGODB_URI='mongodb+srv://...' \
  --from-literal=ADMIN_PASSWORD_HASH='...' \
  --from-literal=JWT_SECRET='...'
# Generate ADMIN_PASSWORD_HASH and JWT_SECRET the same way the root
# README's "Production configuration" section describes.

kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f hpa.yaml
kubectl apply -f pdb.yaml
# ingress.yaml intentionally not applied — see note above.
```

## Notes

- `deployment.yaml` ships with `image: gkoufie/storetrack:latest` as a
  bootstrap placeholder. After the first apply, the CI pipeline's **Deploy
  to Kubernetes** step repoints the running Deployment at each build's
  immutable `<git-sha>` tag via `kubectl set image`.
- Readiness (`/api/health`) fails while MongoDB is unreachable, pulling the
  pod out of the Service; liveness (`/api/health/live`) never checks the
  database, so a database blip won't cause restart-loop pile-ups.
- The container runs as uid/gid `10001` (matching the Dockerfile's
  `storetrack` user) with a read-only root filesystem; only `/tmp` is
  writable (`emptyDir`).
- `pdb.yaml` keeps at least 1 pod available during voluntary disruptions
  (node drains, cluster upgrades); pair with `deployment.yaml`'s
  `maxUnavailable: 0` rolling update for zero-downtime deploys.
