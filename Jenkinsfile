// Requires on the Jenkins controller/agents:
//   - Plugins: Docker Pipeline, SonarQube Scanner, Kubernetes CLI (or kubectl on PATH)
//   - Global Tool Config: a "SonarScanner" tool, and a "SonarQube" server entry
//   - Credentials:
//       docker-registry-credentials  (Docker Hub username + access token)
//       k8s-kubeconfig               (secret file: kubeconfig for the target cluster)
//   - An agent with Docker available (docker.build/withRegistry need the daemon)
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        // Docker Hub: images are pushed as "<dockerhub-username>/<repo>"
        // with no registry hostname prefix (unlike a private/self-hosted
        // registry, where IMAGE_NAME would be "${REGISTRY}/storetrack").
        DOCKERHUB_REGISTRY = 'https://registry.hub.docker.com'
        IMAGE_NAME          = 'gkoufie/storetrack'
        K8S_NAMESPACE       = 'storetrack'
        K8S_DEPLOYMENT      = 'storetrack'
        K8S_CONTAINER       = 'storetrack'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                // The top-level environment{} block above is evaluated before
                // any stage runs, so env.GIT_COMMIT isn't populated yet at
                // that point. Compute the tag here, after checkout, instead.
                script {
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short=7 HEAD', returnStdout: true).trim()
                }
            }
        }

        stage('Install') {
            steps {
                script {
                    // Docker Pipeline runs this container as the host's
                    // jenkins UID (so workspace files come out correctly
                    // owned), but that UID has no /etc/passwd entry in the
                    // node image, so $HOME defaults to "/" and npm can't
                    // create /.npm there (EACCES). Give it a writable HOME.
                    docker.image('node:20-bookworm-slim').inside('-e HOME=/tmp') {
                        sh 'npm ci'
                    }
                }
            }
        }

        stage('Lint') {
            steps {
                script {
                    docker.image('node:20-bookworm-slim').inside('-e HOME=/tmp') {
                        sh 'npm run lint'
                    }
                }
            }
        }

        stage('Test') {
            steps {
                script {
                    docker.image('node:20-bookworm-slim').inside('-e HOME=/tmp') {
                        sh 'npm test'
                    }
                }
            }
        }

        stage('Build') {
            steps {
                script {
                    docker.image('node:20-bookworm-slim').inside('-e HOME=/tmp') {
                        sh 'npm run build'
                    }
                }
            }
        }

        stage('SonarQube Analysis') {
            steps {
                withSonarQubeEnv('SonarQube') {
                    script {
                        def scannerHome = tool 'SonarScanner'
                        sh "${scannerHome}/bin/sonar-scanner"
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Docker Build & Push') {
            // env.BRANCH_NAME is only populated by Multibranch Pipeline jobs.
            // This is a plain "Pipeline script from SCM" job, so gate on
            // GIT_BRANCH instead, which the Git plugin sets either way.
            when { expression { env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main' } }
            steps {
                script {
                    docker.withRegistry(DOCKERHUB_REGISTRY, 'docker-registry-credentials') {
                        def image = docker.build("${IMAGE_NAME}:${IMAGE_TAG}")
                        image.push()
                        image.push('latest')
                    }
                }
            }
        }

        stage('Deploy to Kubernetes') {
            when { expression { env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main' } }
            steps {
                withCredentials([file(credentialsId: 'k8s-kubeconfig', variable: 'KUBECONFIG')]) {
                    sh """
                        kubectl -n ${K8S_NAMESPACE} set image deployment/${K8S_DEPLOYMENT} ${K8S_CONTAINER}=${IMAGE_NAME}:${IMAGE_TAG}
                        kubectl -n ${K8S_NAMESPACE} rollout status deployment/${K8S_DEPLOYMENT} --timeout=120s
                    """
                }
            }
        }
    }

    post {
        always {
            deleteDir()
        }
        failure {
            echo 'Pipeline failed - check the stage logs above.'
        }
    }
}
