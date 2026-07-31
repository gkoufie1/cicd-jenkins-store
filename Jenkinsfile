// Requires on the Jenkins controller/agents:
//   - Plugins: Docker Pipeline, SonarQube Scanner, Kubernetes CLI (or kubectl on PATH)
//   - Global Tool Config: a "SonarScanner" tool, and a "SonarQube" server entry
//   - Credentials:
//       docker-registry-credentials  (username/password or token for REGISTRY)
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
        REGISTRY        = 'registry.example.com'
        IMAGE_NAME      = "${REGISTRY}/storetrack"
        K8S_NAMESPACE   = 'storetrack'
        K8S_DEPLOYMENT  = 'storetrack'
        K8S_CONTAINER   = 'storetrack'
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
                    docker.image('node:20-bookworm-slim').inside {
                        sh 'npm ci'
                    }
                }
            }
        }

        stage('Lint') {
            steps {
                script {
                    docker.image('node:20-bookworm-slim').inside {
                        sh 'npm run lint'
                    }
                }
            }
        }

        stage('Test') {
            steps {
                script {
                    docker.image('node:20-bookworm-slim').inside {
                        sh 'npm test'
                    }
                }
            }
        }

        stage('Build') {
            steps {
                script {
                    docker.image('node:20-bookworm-slim').inside {
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
            when { branch 'main' }
            steps {
                script {
                    docker.withRegistry("https://${REGISTRY}", 'docker-registry-credentials') {
                        def image = docker.build("${IMAGE_NAME}:${IMAGE_TAG}")
                        image.push()
                        image.push('latest')
                    }
                }
            }
        }

        stage('Deploy to Kubernetes') {
            when { branch 'main' }
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
