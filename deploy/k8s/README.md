# FCC Workbench Kubernetes Deployment

Apply the base manifests with:

```bash
kubectl apply -k deploy/k8s
```

Before deploying:

- Replace `ghcr.io/your-org/ai-aml-tool:latest` in `deployment.yaml` with your real image.
- Update the hostname in `ingress.yaml`.
- Adjust the PVC storage class and size for your cluster.
- Add Secrets for any real credentials instead of placing them in the ConfigMap.

Important scaling note:

- The current application still persists critical runtime data on local disk (`DuckDB`, SQLite, generated artefacts).
- Keep Kubernetes replicas at `1` until those stores are externalized to shared managed services.
- Multi-core utilization is handled inside the pod through Gunicorn workers and threads.
