"""Declarative numeric examples: validate expressions, never execute model code."""
import ast
import math
import operator
from pydantic import BaseModel, ConfigDict, Field, model_validator

FUNCTIONS = {'sqrt': math.sqrt, 'abs': abs, 'sin': math.sin, 'cos': math.cos,
             'exp': math.exp, 'log': math.log, 'min': min, 'max': max}
CONSTANTS = {'pi': math.pi, 'e': math.e}
BINARY = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
          ast.Div: operator.truediv, ast.Pow: operator.pow}


def evaluate(expression: str, values: dict[str, float]) -> float:
    try:
        tree = ast.parse(expression.replace('^', '**'), mode='eval')
        if len(list(ast.walk(tree))) > 128:
            raise ValueError('Слишком сложное выражение')
        def visit(node, depth=0):
            if depth > 16:
                raise ValueError('Слишком глубокое выражение')
            child = lambda item: visit(item, depth + 1)
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                result = float(node.value)
            elif isinstance(node, ast.Name) and node.id in (values.keys() | CONSTANTS.keys()):
                result = values.get(node.id, CONSTANTS.get(node.id))
            elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
                result = child(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
            elif isinstance(node, ast.BinOp) and type(node.op) in BINARY:
                left, right = child(node.left), child(node.right)
                if isinstance(node.op, ast.Pow) and abs(right) > 12:
                    raise ValueError('Степень должна быть от -12 до 12')
                result = BINARY[type(node.op)](left, right)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS and not node.keywords:
                count = len(node.args)
                if not (1 <= count <= 4 if node.func.id in ('min', 'max') else count == 1):
                    raise ValueError('Неверное количество аргументов')
                args = [child(arg) for arg in node.args]
                result = (min(args) if node.func.id == 'min' else max(args)) if node.func.id in ('min', 'max') else FUNCTIONS[node.func.id](*args)
            else:
                raise ValueError('Разрешены только числа, параметры, арифметика и учебные функции')
            if isinstance(result, complex) or not math.isfinite(result) or abs(result) > 1e100:
                raise ValueError('Результат вне допустимого диапазона')
            return result
        return float(visit(tree.body))
    except (SyntaxError, TypeError, ArithmeticError, RecursionError) as error:
        raise ValueError('Выражение не вычисляется при этих параметрах') from error


class Parameter(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    name: str = Field(pattern=r'^[a-z][a-z0-9_]{0,15}$')
    label: str = Field(min_length=1, max_length=150)
    minimum: float = Field(ge=-1e6, le=1e6)
    maximum: float = Field(ge=-1e6, le=1e6)
    step: float = Field(gt=0, le=1e6)
    initial: float = Field(ge=-1e6, le=1e6)

    @model_validator(mode='after')
    def bounds(self):
        if self.name in FUNCTIONS or self.name in CONSTANTS:
            raise ValueError('Имя параметра зарезервировано')
        if not self.minimum < self.maximum or not self.minimum <= self.initial <= self.maximum:
            raise ValueError('Неверные границы параметра')
        if self.step > self.maximum - self.minimum or (self.maximum - self.minimum) / self.step > 10000:
            raise ValueError('Неверный шаг параметра')
        return self


class Calculation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    label: str = Field(min_length=1, max_length=200)
    expression: str = Field(min_length=1, max_length=300)
    unit: str = Field(default='', max_length=40)


class InteractiveLab(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=200)
    topic: str = Field(min_length=1, max_length=150)
    explanation: str = Field(min_length=1, max_length=2000)
    task: str = Field(min_length=1, max_length=1000)
    formula: str = Field(min_length=1, max_length=1000)
    parameters: list[Parameter] = Field(min_length=1, max_length=6)
    outputs: list[Calculation] = Field(min_length=1, max_length=6)
    plot_variable: str | None = None

    @model_validator(mode='after')
    def expressions(self):
        values = {parameter.name: parameter.initial for parameter in self.parameters}
        if len(values) != len(self.parameters):
            raise ValueError('Имена параметров должны быть уникальны')
        if self.plot_variable is not None and self.plot_variable not in values:
            raise ValueError('Неизвестный параметр графика')
        for output in self.outputs:
            evaluate(output.expression, values)
        return self
