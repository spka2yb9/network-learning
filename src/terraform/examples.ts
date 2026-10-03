/** Example workspaces used by the Terraform chapter, labs and tests. */
export const starterFiles = (): Record<string, string> => ({
  'main.tf': `# Terraform 本体の設定です。使うプロバイダ（AWSと話すプラグイン）と、そのバージョンを決めます。
# "~> 5.0" は「5.x の範囲で新しいもの」という意味です。
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# AWSのどのリージョン（地域）に作るかを指定します。値は variables.tf の変数から受け取ります。
provider "aws" {
  region = var.region
}

# VPCを1つ作ります。aws_vpc.main が、このリソースのアドレス（Terraform の中での住所）です。
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  tags = {
    Name = "\${var.project}-vpc"
  }
}
`,
  'variables.tf': `# 外から与える入力値（variable）です。コードでは var.region のように参照します。
# default は既定値です。terraform.tfvars に書くと上書きできます。
variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "project" {
  type    = string
  default = "path"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}
`,
  'outputs.tf': `# apply の後に表示する値（output）です。terraform output でも確認できます。
output "vpc_id" {
  value = aws_vpc.main.id
}
`,
});

/** Capstone 4 expressed as Terraform: ALB in public subnets, app in private subnets (no DB tier: capstone-6 adds it). */
export const threeTierFiles = (): Record<string, string> => ({
  ...starterFiles(),
  'network.tf': `# 使えるAZ（Availability Zone）の一覧を読み取ります。data は、既存の情報を読むだけのブロックです。
data "aws_availability_zones" "available" {}

# locals は、このモジュールの中で使う名前付きの値です。ここでは先頭の2つのAZを使います。
locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

# VPCとインターネットをつなぐ出入口（Internet Gateway）です。
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

# パブリックサブネットを、AZごとに1つずつ作ります（count で繰り返し）。
# アドレスは cidrsubnet でVPCの範囲を /24 に分けて計算します（既定値なら 10.0.1.0/24 と 10.0.2.0/24）。
resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 1)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags = {
    Name = "public-\${count.index}"
  }
}

# アプリ用のプライベートサブネットです（既定値なら 10.0.11.0/24 と 10.0.12.0/24）。
resource "aws_subnet" "app" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 11)
  availability_zone = local.azs[count.index]
  tags = {
    Name = "app-\${count.index}"
  }
}

# NAT Gateway に付ける Elastic IP（固定のパブリックIP）です。
resource "aws_eip" "nat" {
  domain = "vpc"
}

# プライベートサブネットから外へ出るための NAT Gateway です。パブリックサブネットに置きます。
# コードに IGW への参照はありませんが、IGW がないと外へ出られないため、depends_on で「IGW が先」と明示します。
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]
}

# パブリック用のルートテーブルです。0.0.0.0/0（インターネット宛て）を IGW へ向けます。
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

# プライベート用のルートテーブルです。0.0.0.0/0 を NAT Gateway へ向けます。
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
}

# サブネットとルートテーブルを関連付けます。どのルートテーブルを使うかで、パブリックかプライベートかが決まります。
resource "aws_route_table_association" "public" {
  count          = length(local.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "app" {
  count          = length(local.azs)
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.private.id
}
`,
  'security.tf': `# ALB 用のセキュリティグループです。インターネットからの HTTPS（443）だけを許可します。
# Terraform で作る SG には、外向き（egress）の既定の許可がありません。必要な egress は自分で書きます。
resource "aws_security_group" "alb" {
  name   = "alb-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# アプリ用のセキュリティグループです。ALB の SG が付いた相手からの 8080 だけを許可します（SG参照）。
resource "aws_security_group" "app" {
  name   = "app-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`,
  'compute.tf': `# 起動に使うOSイメージ（AMI）を読み取ります。このシミュレータでは架空のイメージが返ります。
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
}

# アプリ用のEC2インスタンスを、AZごとに1台ずつプライベートサブネットに置きます。
# Role / Listen タグは、OSが待ち受けるポートを伝える、このシミュレータ独自の約束です（実際のAWSでは単なるタグです）。
resource "aws_instance" "app" {
  count                  = length(local.azs)
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.app[count.index].id
  vpc_security_group_ids = [aws_security_group.app.id]
  tags = {
    Name   = "app-\${count.index}"
    Role   = "app"
    Listen = "8080"
  }
}

# インターネットから通信を受ける ALB（Application Load Balancer）です。パブリックサブネットに置きます。
resource "aws_lb" "web" {
  name               = "web-alb"
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
}

# ALB の転送先（ターゲット）のまとまりです。アプリの 8080 番へ転送します。
resource "aws_lb_target_group" "app" {
  name     = "app-tg"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id
}

# ターゲットグループに、アプリのインスタンスを登録します。
resource "aws_lb_target_group_attachment" "app" {
  count            = length(local.azs)
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_instance.app[count.index].id
}

# ALB が 443 番（HTTPS）で受け、ターゲットグループへ転送するリスナーです。
# 実際のAWSでは、HTTPS のリスナーに証明書（certificate_arn）も必要です。
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
`,
  'outputs.tf': `# apply の後に表示する値です。alb_dns_name は、ブラウザからアクセスするときの ALB の名前（DNS名）です。
output "vpc_id" {
  value = aws_vpc.main.id
}

output "alb_dns_name" {
  value = aws_lb.web.dns_name
}
`,
});
