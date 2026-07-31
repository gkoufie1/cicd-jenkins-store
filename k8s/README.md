# Kubernetes manifests

Plain manifests (no Helm/Kustomize) for running StoreTrack. The Jenkins
pipeline (`../Jenkinsfile`) only runs `kubectl set image` + `rollout status`
against an already-existing Deployment, so these need to be applied once
up front (and again whenever non-image fields change).

## Prerequisites

- A cluster with an ingress controller (manifests assume `ingressClassName: nginx`)
  and `metrics-server` installed (required for the HPA's CPU/memory metrics).
- `cert-manager` with a `letsencrypt-prod` `ClusterIssuer`, or edit/remove the
  TLS annotations in `ingress.yaml`.
- A real hostname in place of `storetrack.example.com`, and a real registry
  in place of `registry.example.com` (also update `Jenkinsfile`'s `REGISTRY`
  and `deployment.yaml`'s image).

## Apply order

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml

# Populate real secrets out-of-band — do NOT apply secret.yaml as-is.
# See the instructions inside secret.yaml.

kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
kubectl apply -f hpa.yaml
kubectl apply -f pdb.yaml
```

Or, once secrets are populated separately: `kubectl apply -f k8s/ --recursive`
(kubectl skips `secret.yaml`'s placeholder values only if you've removed the
file locally after creating the real Secret another way — otherwise applying
this directory will overwrite the real Secret with placeholders).

## Notes

- `deployment.yaml` ships with `image: registry.example.com/storetrack:latest`
  as a bootstrap placeholder. After the first apply, `Jenkinsfile`'s
  **Deploy to Kubernetes** stage repoints the running Deployment at each
  build's immutable `<git-sha>` tag via `kubectl set image`.
- Readiness (`/api/health`) fails while MongoDB is unreachable, pulling the
  pod out of the Service; liveness (`/api/health/live`) never checks the
  database, so a database blip won't cause restart-loop pile-ups.
- The container runs as uid/gid `10001` (matching the Dockerfile's
  `storetrack` user) with a read-only root filesystem; only `/tmp` is
  writable (`emptyDir`).
- `pdb.yaml` keeps at least 1 pod available during voluntary disruptions
  (node drains, cluster upgrades); pair with `deployment.yaml`'s
  `maxUnavailable: 0` rolling update for zero-downtime deploys.
