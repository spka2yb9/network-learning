import { describe, expect, it } from 'vitest';
import { TerraformWorkspace } from './engine';
import { parseHcl } from './parser/parser';
import { functions } from './evaluator/evaluate';
import { formatHcl } from './fmt';
import { starterFiles, threeTierFiles } from './examples';
import { analyzePath } from '../aws/analyzer';
import { validateModel } from '../aws/model';
import { terraformLabs } from '../labs/cloud';
import { terraformTemplates } from '../application/designs';

const ws = (files = starterFiles()) => { const w = new TerraformWorkspace({ files }); w.run('init'); return w; };

describe('HCL subset parser', () => {
  it('parses blocks, interpolation, references, calls and operators', () => {
    const body = parseHcl('resource "aws_subnet" "a" {\n  count = 2\n  cidr_block = cidrsubnet(var.cidr, 8, count.index + 1)\n  tags = { Name = "sub-${count.index}" }\n  ids = aws_subnet.x[*].id\n}\n');
    expect(body[0]).toMatchObject({ kind: 'block', type: 'resource', labels: ['aws_subnet', 'a'] });
  });
  it('reports errors with file and line', () => {
    expect(() => parseHcl('resource "aws_vpc" "main" {\n  cidr_block = \n}', 'main.tf')).toThrow(/main\.tf:2/);
    expect(() => parseHcl('x = <<EOF\nhi\nEOF')).toThrow(/ヒアドキュメント/);
    expect(() => parseHcl('resource "a" "b" {\n  x = [for s in var.l : s]\n}')).toThrow(/for 式/);
  });
  it('handles $${ and \\u escapes; format %% and negative cidrhost', () => {
    expect(parseHcl('x = "$${foo} \\u00e9"\n')[0]).toMatchObject({ value: { kind: 'literal', value: '${foo} é' } });
    const pos = { line: 1, column: 1, file: 'main.tf' };
    expect(functions.format(['%d%%', 5], pos)).toBe('5%');
    expect(functions.cidrhost(['10.0.0.0/24', -1], pos)).toBe('10.0.0.255');
  });
  const pos = { line: 1, column: 1, file: 'main.tf' };
  it('format supports flags, width and precision and errors on missing arguments', () => {
    expect(functions.format(['web-%02d|%-3s|%5.1f|%q|%+d', 3, 'a', 3.14159, 'x', 4], pos)).toBe('web-03|a  |  3.1|"x"|+4');
    expect(() => functions.format(['%s-%s', 'a'], pos)).toThrow(/値がありません/);
  });
  it('range supports step and counting down; step 0 is an error', () => {
    expect([functions.range([1, 10, 2], pos), functions.range([3, 0], pos)]).toEqual([[1, 3, 5, 7, 9], [3, 2, 1]]);
    expect(() => functions.range([1, 3, 0], pos)).toThrow(/step/);
  });
  it('element rejects negative and fractional indexes', () => {
    expect(() => functions.element([['a', 'b'], -1], pos)).toThrow(/0 以上の整数/);
    expect(() => functions.element([['a', 'b'], 1.5], pos)).toThrow(/0 以上の整数/);
  });
  it('tonumber accepts numbers and numeric strings only', () => {
    expect([functions.tonumber([' 5 '], pos), functions.tonumber([3], pos), functions.tonumber([null], pos)]).toEqual([5, 3, null]);
    expect(() => functions.tonumber([''], pos)).toThrow(/tonumber/);
    expect(() => functions.tonumber([true], pos)).toThrow(/tonumber/);
  });
  it('newlines are ignored inside parentheses and call arguments', () => {
    expect(parseHcl('x = (\n  true\n  ? 1\n  : 2\n)\ny = max(\n  1\n  + 2,\n  merge({\n    a = 1\n    b = 2\n  })\n)\n')).toHaveLength(2);
  });
  it('string escapes: \\r, \\u, \\U and unknown escapes are errors', () => {
    expect(parseHcl('x = "a\\rb\\U0001F600"\n')[0]).toMatchObject({ value: { value: 'a\rb😀' } });
    expect(() => parseHcl('x = "a\\qb"\n')).toThrow(/エスケープ/);
  });
});

describe('Terraform workflow (educational engine)', () => {
  it('requires init, then plans with unknown computed values', () => {
    const w = new TerraformWorkspace({ files: starterFiles() });
    expect(w.run('plan')).toContain('terraform init');
    w.run('init');
    const plan = w.run('plan');
    expect(plan).toContain('# aws_vpc.main will be created');
    expect(plan).toContain('+ cidr_block');
    expect(plan).toMatch(/id\s+= \(known after apply\)/);
    expect(plan).toContain('Plan: 1 to add, 0 to change, 0 to destroy.');
    expect(plan).toContain('教育用シミュレーション');
  });
  it('apply creates resources in dependency order; a second plan has no changes', () => {
    const w = ws(threeTierFiles());
    const out = w.run('apply -auto-approve');
    expect(out).toContain('Apply complete! Resources: 23 added, 0 changed, 0 destroyed.');
    const order = out.split('\n').filter(l => l.endsWith('Creating...')).map(l => l.split(':')[0]);
    expect(order.indexOf('aws_vpc.main')).toBeLessThan(order.indexOf('aws_subnet.public[0]'));
    expect(order.indexOf('aws_internet_gateway.main')).toBeLessThan(order.indexOf('aws_nat_gateway.main'));
    expect(order.indexOf('aws_lb_target_group.app')).toBeLessThan(order.indexOf('aws_lb_listener.https'));
    expect(w.run('output')).toMatch(/alb_dns_name = "web-alb-/);
    expect(w.run('plan')).toContain('No changes');
    expect(w.run('state list')).toContain('aws_subnet.app[1]');
  });
  it('the applied infrastructure is valid and reachable through the ALB', () => {
    const w = ws(threeTierFiles()); w.run('apply -auto-approve');
    const m = w.awsModel();
    expect(validateModel(m)).toEqual([]);
    const alb = m.loadBalancers[0];
    expect(analyzePath(m, { kind: 'internet', ip: '198.51.100.77' }, { kind: 'lb', id: alb.id }, 'tcp', 443).reachable).toBe(true);
    const app = m.instances[0];
    expect(analyzePath(m, { kind: 'instance', id: app.id }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443).reachable).toBe(true);
  });
  it('forceNew attributes replace; tags update in place; removed blocks destroy', () => {
    const w = ws(threeTierFiles()); w.run('apply -auto-approve');
    w.files['network.tf'] = w.files['network.tf'].replace('cidrsubnet(var.vpc_cidr, 8, count.index + 11)', 'cidrsubnet(var.vpc_cidr, 8, count.index + 21)');
    const replace = w.run('plan');
    expect(replace).toContain('# aws_subnet.app[0] must be replaced');
    expect(replace).toMatch(/cidr_block\s+= "10\.0\.11\.0\/24" -> "10\.0\.21\.0\/24" # forces replacement/);
    expect(replace).toContain('aws_instance.app[0] must be replaced');
    w.files = threeTierFiles();
    w.files['main.tf'] = w.files['main.tf'].replace('Name = "${var.project}-vpc"', 'Name = "renamed-vpc"');
    const update = w.run('plan');
    expect(update).toContain('# aws_vpc.main will be updated in-place');
    expect(update).toContain('Plan: 0 to add, 1 to change, 0 to destroy.');
    w.files = threeTierFiles();
    w.files['compute.tf'] = w.files['compute.tf'].slice(0, w.files['compute.tf'].indexOf('resource "aws_lb_listener"'));
    expect(w.run('plan')).toContain('# aws_lb_listener.https will be destroyed');
    expect(w.run('apply -auto-approve')).toContain('1 destroyed');
    w.files = threeTierFiles(); // user_data changes are in-place (AWS provider v5 without user_data_replace_on_change)
    w.files['compute.tf'] = w.files['compute.tf'].replace('instance_type          = "t3.micro"', 'instance_type          = "t3.micro"\n  user_data              = "#!/bin/bash"');
    expect(w.run('plan')).toContain('# aws_instance.app[0] will be updated in-place');
  });
  it('ignore_changes survives unrelated updates; replacements count as destroyed', () => {
    const files = starterFiles();
    files['main.tf'] = files['main.tf'].replace('  tags = {', '  lifecycle {\n    ignore_changes = [tags]\n  }\n\n  tags = {');
    const w = ws(files); w.run('apply -auto-approve');
    const id = w.state.resources['aws_vpc.main'].id;
    w.consoleChange(c => { c.resources[id].attributes.tags = { Name: 'console' }; });
    w.files['main.tf'] = w.files['main.tf'].replace('cidr_block = var.vpc_cidr', 'cidr_block           = var.vpc_cidr\n  enable_dns_hostnames = true');
    expect(w.run('apply -auto-approve')).toContain('0 added, 1 changed, 0 destroyed');
    expect(w.cloud.resources[id].attributes.tags).toEqual({ Name: 'console' });
    w.files['terraform.tfvars'] = 'vpc_cidr = "10.9.0.0/16"\n';
    expect(w.run('apply -auto-approve')).toContain('1 added, 0 changed, 1 destroyed');
    w.files['main.tf'] = w.files['main.tf'].replace('ignore_changes = [tags]', 'create_before_destroy = true');
    w.files['terraform.tfvars'] = 'vpc_cidr = "10.8.0.0/16"\n';
    expect(w.run('apply -auto-approve')).toContain('1 added, 0 changed, 1 destroyed');
  });
  it('lifecycle prevent_destroy and ignore_changes', () => {
    const files = starterFiles();
    files['main.tf'] = files['main.tf'].replace('  tags = {', '  lifecycle {\n    prevent_destroy = true\n    ignore_changes  = [tags]\n  }\n\n  tags = {');
    const w = ws(files); w.run('apply -auto-approve');
    w.files['main.tf'] = w.files['main.tf'].replace('${var.project}-vpc', 'other');
    expect(w.run('plan')).toContain('No changes');
    expect(w.run('destroy -auto-approve')).toContain('Instance cannot be destroyed');
  });
  it('detects drift made outside Terraform and plans to restore the configuration', () => {
    const w = ws(threeTierFiles()); w.run('apply -auto-approve');
    const sg = w.state.resources['aws_security_group.app'].id;
    w.consoleChange(c => { (c.resources[sg].attributes.ingress as unknown[]).push({ from_port: 22, to_port: 22, protocol: 'tcp', cidr_blocks: ['0.0.0.0/0'] }); });
    const plan = w.run('plan');
    expect(plan).toContain('Objects have changed outside of Terraform');
    expect(plan).toContain('aws_security_group.app has changed');
    expect(plan).toContain('# aws_security_group.app will be updated in-place');
    const nat = w.state.resources['aws_nat_gateway.main'].id;
    w.consoleChange(c => { delete c.resources[nat]; });
    const again = w.run('plan');
    expect(again).toContain('aws_nat_gateway.main has been deleted');
    expect(again).toContain('# aws_nat_gateway.main will be created');
  });
  it('import brings a console-created resource under management', () => {
    const w = ws();
    w.consoleChange(c => { c.resources['vpc-0console1'] = { id: 'vpc-0console1', type: 'aws_vpc', origin: 'console', attributes: { id: 'vpc-0console1', cidr_block: '10.0.0.0/16', enable_dns_support: true, enable_dns_hostnames: false, tags: { Name: 'path-vpc' }, main_route_table_id: 'rtb-0c1', default_network_acl_id: 'acl-0c1', default_security_group_id: 'sg-0c1', arn: 'arn:x' } }; });
    expect(w.run('import aws_vpc.missing vpc-0console1')).toContain('does not exist');
    expect(w.run('import aws_vpc.main vpc-0console1')).toContain('Import successful');
    expect(w.run('plan')).toContain('No changes');
  });
  it('state locking prevents concurrent applies', () => {
    const w = ws(); w.lock = { id: 'a1b2', who: 'teammate@ci', operation: 'OperationTypeApply' };
    expect(w.run('apply -auto-approve')).toContain('Error acquiring the state lock');
    expect(w.run('force-unlock a1b2')).toContain('unlocked');
    expect(w.run('apply -auto-approve')).toContain('Apply complete');
  });
  it('confirm re-checks the lock and refuses a plan made before the code changed', () => {
    const w = ws(); w.run('apply');
    w.lock = { id: 'a1b2', who: 'teammate@ci', operation: 'OperationTypeApply' };
    expect(w.confirm(true)).toContain('Error acquiring the state lock');
    w.lock = undefined; w.run('apply'); w.files['main.tf'] = w.files['main.tf'].replace('var.vpc_cidr', '"10.1.0.0/16"');
    expect(w.confirm(true)).toContain('Saved plan is stale');
    expect(Object.keys(w.cloud.resources)).toHaveLength(0);
    w.run('apply'); expect(w.confirm(true)).toContain('Apply complete');
  });
  it('errors from functions and .tfvars become diagnostics instead of escaping', () => {
    const w = ws();
    w.files['bad.tf'] = 'resource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = cidrsubnet("10.0.0.0", 8, 1)\n}\n';
    expect(w.run('plan')).toMatch(/cidrsubnet: "10\.0\.0\.0"[^]*on bad\.tf line 3/);
    delete w.files['bad.tf']; w.files['terraform.tfvars'] = 'vpc_cidr = \n';
    expect(w.run('plan')).toContain('on terraform.tfvars line 1');
  });
  it('validate catches unsupported arguments, undeclared references, unknown functions and cycles', () => {
    const w = ws();
    w.files['bad.tf'] = 'resource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.nope.id\n  cidr_block = "10.0.1.0/24"\n}\n';
    expect(w.run('validate')).toContain('Reference to undeclared resource');
    w.files['bad.tf'] = 'resource "aws_subnet" "a" {\n  vpc_id  = aws_vpc.main.id\n  cidr    = "10.0.1.0/24"\n}\n';
    expect(w.run('validate')).toContain('Unsupported argument');
    w.files['bad.tf'] = 'resource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = magic(1)\n}\n';
    expect(w.run('validate')).toContain('unknown function');
    w.files['bad.tf'] = 'resource "aws_subnet" "a" {\n  vpc_id = aws_vpc.main.id\n}\n';
    expect(w.run('validate')).toContain('"cidr_block" が必要');
    w.files['bad.tf'] = 'resource "aws_security_group" "a" {\n  vpc_id = aws_vpc.main.id\n  name   = aws_security_group.b.id\n}\nresource "aws_security_group" "b" {\n  vpc_id = aws_vpc.main.id\n  name   = aws_security_group.a.id\n}\n';
    expect(w.run('validate')).toContain('Cycle');
    w.files['bad.tf'] = 'resource "aws_s3_bucket" "x" {\n  bucket = "y"\n}\n';
    expect(w.run('validate')).toContain('未対応');
    delete w.files['bad.tf'];
    expect(w.run('validate')).toContain('Success! The configuration is valid.');
  });
  it('count cannot depend on values known only after apply', () => {
    const w = ws();
    w.files['bad.tf'] = 'resource "aws_subnet" "a" {\n  count      = length(aws_vpc.main.id)\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.1.0/24"\n}\n';
    expect(w.run('plan')).toContain('Invalid count argument');
    w.files['bad.tf'] = 'resource "aws_subnet" "s" {\n  count      = 2\n  vpc_id     = aws_vpc.main.id\n  cidr_block = cidrsubnet(var.vpc_cidr, 8, count.index)\n}\nresource "aws_route_table" "r" {\n  count  = length(aws_subnet.s)\n  vpc_id = aws_vpc.main.id\n}\n';
    expect(w.run('plan')).toContain('# aws_route_table.r[1] will be created');
  });
  it('AWS API errors stop apply part-way (partial apply stays in state)', () => {
    const w = ws();
    w.files['bad.tf'] = 'resource "aws_subnet" "outside" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "192.168.1.0/24"\n}\n';
    const out = w.run('apply -auto-approve');
    expect(out).toContain('AWS API エラー');
    expect(out).toContain('範囲外');
    expect(w.run('state list')).toBe('aws_vpc.main');
  });
  it('local modules with variables and outputs', () => {
    const files: Record<string, string> = {
      'main.tf': 'module "network" {\n  source = "./modules/vpc"\n  cidr   = "10.20.0.0/16"\n  name   = "shared"\n}\n\noutput "vpc" {\n  value = module.network.vpc_id\n}\n',
      'modules/vpc/main.tf': 'variable "cidr" {}\nvariable "name" {}\n\nresource "aws_vpc" "this" {\n  cidr_block = var.cidr\n  tags = {\n    Name = var.name\n  }\n}\n\noutput "vpc_id" {\n  value = aws_vpc.this.id\n}\n',
    };
    const w = ws(files);
    expect(w.run('plan')).toContain('# module.network.aws_vpc.this will be created');
    expect(w.run('apply -auto-approve')).toMatch(/vpc = "vpc-/);
    expect(w.awsModel().vpcs[0]).toMatchObject({ name: 'shared', cidr: '10.20.0.0/16' });
    w.files['main.tf'] = w.files['main.tf'].replace('  name   = "shared"\n', '');
    expect(w.run('plan')).toContain('No value for required variable: name');
  });
  it('modules: depends_on orders apply after the whole module; destroy removes everything and clears outputs', () => {
    const w = ws({
      'main.tf': 'resource "aws_vpc" "extra" {\n  cidr_block = "10.1.0.0/16"\n}\nresource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\nresource "aws_internet_gateway" "g" {\n  vpc_id     = aws_vpc.main.id\n  depends_on = [module.m]\n}\nmodule "m" {\n  source = "./m"\n  vpc_id = aws_vpc.main.id\n}\noutput "rt" {\n  value = module.m.rt\n}\n',
      'm/main.tf': 'variable "vpc_id" {}\nresource "aws_route_table" "a" {\n  vpc_id = var.vpc_id\n}\nresource "aws_route_table" "b" {\n  vpc_id = var.vpc_id\n  tags = {\n    Name = aws_route_table.a.id\n  }\n}\noutput "rt" {\n  value = aws_route_table.a.id\n}\n',
    });
    const order = w.run('apply -auto-approve').split('\n').filter(l => l.endsWith('Creating...')).map(l => l.split(':')[0]);
    expect(order.indexOf('module.m.aws_route_table.b')).toBeLessThan(order.indexOf('aws_internet_gateway.g'));
    expect(w.run('destroy -auto-approve')).toContain('5 destroyed');
    expect(Object.keys(w.cloud.resources)).toHaveLength(0);
    expect(w.run('output')).toBe('No outputs found.');
  });
  it('only terraform.tfvars and *.auto.tfvars are loaded automatically', () => {
    const w = ws(); w.files['prod.tfvars'] = 'vpc_cidr = "10.8.0.0/16"\n';
    expect(w.run('plan')).toContain('"10.0.0.0/16"');
    w.files['prod.auto.tfvars'] = 'vpc_cidr = "10.9.0.0/16"\n';
    expect(w.run('plan')).toContain('"10.9.0.0/16"');
  });
  it('tfvars override defaults and undeclared variables are rejected', () => {
    const w = ws();
    w.files['terraform.tfvars'] = 'vpc_cidr = "10.9.0.0/16"\n';
    expect(w.run('plan')).toContain('"10.9.0.0/16"');
    w.files['terraform.tfvars'] = 'typo_cidr = "10.9.0.0/16"\n';
    expect(w.run('plan')).toContain('undeclared variable');
  });
  it('Terraform-created security groups have no default egress (unlike the console)', () => {
    const files = threeTierFiles();
    files['security.tf'] = files['security.tf'].replace(/  egress \{\n    from_port   = 0\n    to_port     = 0\n    protocol    = "-1"\n    cidr_blocks = \["0.0.0.0\/0"\]\n  \}\n\}\n$/, '}\n');
    const w = ws(files); w.run('apply -auto-approve');
    const m = w.awsModel();
    const r = analyzePath(m, { kind: 'instance', id: m.instances[0].id }, { kind: 'internet', ip: '198.51.100.10' }, 'tcp', 443);
    expect(r.blocked?.component).toBe('Security Group');
  });
  it('a pending plan is stale once the state changes (no duplicate VPC from an old prompt)', () => {
    const w = ws(); w.run('apply'); w.run('apply -auto-approve');
    expect(w.confirm(true)).toContain('Saved plan is stale');
    expect(Object.values(w.cloud.resources).filter(r => r.type === 'aws_vpc')).toHaveLength(1);
  });
  it('unsupported flags are rejected, not ignored; plan -destroy previews a destroy', () => {
    const w = ws(); w.run('apply -auto-approve');
    expect(w.run('destroy -target=aws_vpc.main -auto-approve')).toContain('使えない引数です: -target=aws_vpc.main');
    expect(Object.keys(w.cloud.resources)).toHaveLength(1);
    expect(w.run('plan -destroy')).toContain('Plan: 0 to add, 0 to change, 1 to destroy.');
  });
  it('state rm needs the state lock', () => {
    const w = ws(); w.run('apply -auto-approve'); w.lock = { id: 'a1b2', who: 'teammate@ci', operation: 'OperationTypeApply' };
    expect(w.run('state rm aws_vpc.main')).toContain('Error acquiring the state lock');
    expect(w.state.resources['aws_vpc.main']).toBeDefined();
  });
  it('a variable default of null is valid for any type', () => {
    const files = starterFiles(); files['variables.tf'] += '\nvariable "note" {\n  type    = string\n  default = null\n}\n';
    expect(ws(files).run('validate')).toContain('Success!');
  });
  it('a string that is exactly one interpolation keeps the value type', () => {
    const files = starterFiles(); files['extra.tf'] = 'resource "aws_subnet" "s" {\n  count                   = "${1 + 1}"\n  vpc_id                  = aws_vpc.main.id\n  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)\n  map_public_ip_on_launch = "${true}"\n}\n';
    expect(ws(files).run('plan')).toContain('# aws_subnet.s[1] will be created');
  });
  it('an in-place update of an aws_lb keeps its dns_name', () => {
    const w = ws(threeTierFiles()); w.run('apply -auto-approve'); const before = w.run('output');
    w.files['compute.tf'] = w.files['compute.tf'].replace('  name               = "web-alb"\n', '  name               = "web-alb"\n  tags               = { Team = "web" }\n');
    expect(w.run('apply -auto-approve')).toContain('1 changed');
    expect(w.run('output')).toBe(before);
  });
  it('ignore_changes = all ignores every argument', () => {
    const w = ws(); w.run('apply -auto-approve');
    w.files['main.tf'] = w.files['main.tf'].replace('Name = "${var.project}-vpc"', 'Name = "renamed"\n  }\n  lifecycle {\n    ignore_changes = all');
    expect(w.run('plan')).toContain('No changes');
  });
  it('depends_on on a module block makes the resources inside depend on it', () => {
    const w = ws({ 'main.tf': 'resource "aws_vpc" "a" {\n  cidr_block = "10.0.0.0/16"\n}\nmodule "m" {\n  source     = "./m"\n  depends_on = [aws_vpc.a]\n}\n', 'm/main.tf': 'resource "aws_vpc" "b" {\n  cidr_block = "10.1.0.0/16"\n}\n' });
    w.run('apply -auto-approve');
    expect(w.state.resources['module.m.aws_vpc.b'].dependencies).toContain('aws_vpc.a');
  });
  it('length(concat(...)) of lists with unknown elements is known at plan time', () => {
    const files = threeTierFiles(); files['extra.tf'] = 'resource "aws_route_table_association" "x" {\n  count          = length(concat(aws_subnet.public[*].id, aws_subnet.app[*].id))\n  subnet_id      = aws_subnet.public[0].id\n  route_table_id = aws_route_table.public.id\n}\n';
    expect(ws(files).run('plan')).toContain('# aws_route_table_association.x[3] will be created');
  });
  it('aws_lb_target_group_attachment port is rejected (per-target ports are not modelled)', () => {
    const files = threeTierFiles(); files['compute.tf'] = files['compute.tf'].replace('  target_id        = aws_instance.app[count.index].id\n', '  target_id        = aws_instance.app[count.index].id\n  port             = 9090\n');
    expect(ws(files).run('validate')).toContain('Unsupported argument: "port"');
  });
  it('the 3-tier template description matches its files (no DB tier)', () => {
    expect(terraformTemplates['three-tier'].description).toContain('DBなし');
    expect(Object.values(threeTierFiles()).join()).not.toMatch(/Role\s*=\s*"db"/);
  });
  it('destroy removes everything in reverse dependency order', () => {
    const w = ws(threeTierFiles()); w.run('apply -auto-approve');
    const out = w.run('destroy -auto-approve');
    const order = out.split('\n').filter(l => l.includes('Destruction complete')).map(l => l.split(':')[0]);
    expect(order.indexOf('aws_subnet.public[0]')).toBeLessThan(order.indexOf('aws_vpc.main'));
    expect(out).toContain('23 destroyed');
    expect(Object.keys(w.cloud.resources)).toHaveLength(0);
  });
  it('tf-ts-01 grader treats an all-protocol ingress rule as open SSH', () => {
    const lab = terraformLabs.find(l => l.id === 'tf-ts-01')!;
    const w = new TerraformWorkspace(lab.build());
    w.consoleChange(c => { c.resources[w.state.resources['aws_security_group.app'].id].attributes.ingress = [{ from_port: 0, to_port: 0, protocol: '-1', cidr_blocks: ['0.0.0.0/0'] }]; });
    expect(lab.grade(w).find(r => r.label.includes('22番'))?.pass).toBe(false);
    lab.solve(w); expect(lab.grade(w).every(r => r.pass)).toBe(true);
  });
});

describe('fmt', () => {
  it('indents one level per line of net open brackets and is a no-op on canonical examples', () => {
    const canonical = 'resource "aws_vpc" "a" {\n  tags = merge(local.tags, {\n    Name = "x"\n  })\n}\n';
    expect(formatHcl(canonical)).toBe(canonical);
    for (const src of [...Object.values(starterFiles()), ...Object.values(threeTierFiles())]) expect(formatHcl(src)).toBe(src);
  });
  it('brackets inside /* */ comments do not change indentation', () => {
    const src = 'resource "aws_vpc" "a" {\n  x = 1 /* { */\n  /* (\n  [ */\n  y = 2\n}\n';
    expect(formatHcl(src)).toBe(src);
  });
  it('re-indents and aligns equals signs', () => {
    expect(formatHcl('resource "aws_vpc" "main" {\ncidr_block = "10.0.0.0/16"\n    enable_dns_hostnames=true\n}\n')).toBe('resource "aws_vpc" "main" {\n  cidr_block           = "10.0.0.0/16"\n  enable_dns_hostnames = true\n}\n');
    const w = ws(); w.files['main.tf'] = w.files['main.tf'].replace('  cidr_block = var.vpc_cidr', 'cidr_block=var.vpc_cidr');
    expect(w.run('fmt -check')).toContain('main.tf');
    w.run('fmt');
    expect(w.files['main.tf']).toContain('  cidr_block = var.vpc_cidr');
  });
});
