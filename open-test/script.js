// 获取 DOM 元素
const todoInput = document.getElementById("todo-input");
const addBtn = document.getElementById("add-btn");
const todoList = document.getElementById("todo-list");
const totalCount = document.getElementById("total-count");
const completedCount = document.getElementById("completed-count");

// 从 localStorage 加载待办事项
let todos = JSON.parse(localStorage.getItem("todos")) || [];

// 初始化渲染
renderTodos();

// 添加待办事项
function addTodo() {
  const text = todoInput.value.trim();

  if (text === "") {
    todoInput.style.borderColor = "#dc3545";
    setTimeout(() => {
      todoInput.style.borderColor = "#e0e0e0";
    }, 1000);
    return;
  }

  const todo = {
    id: Date.now(),
    text: text,
    completed: false,
  };

  todos.unshift(todo);
  saveTodos();
  renderTodos();
  todoInput.value = "";
  todoInput.focus();
}

// eslint-disable-next-line no-unused-vars
function toggleTodo(id) {
  todos = todos.map((todo) => {
    if (todo.id === id) {
      return { ...todo, completed: !todo.completed };
    }
    return todo;
  });
  saveTodos();
  renderTodos();
}

// 删除待办事项
// eslint-disable-next-line no-unused-vars -- called from HTML onclick
function deleteTodo(id) {
  todos = todos.filter((todo) => todo.id !== id);
  saveTodos();
  renderTodos();
}

// 保存到 localStorage
function saveTodos() {
  localStorage.setItem("todos", JSON.stringify(todos));
}

// 渲染待办事项列表
function renderTodos() {
  todoList.innerHTML = "";

  // 更新统计信息
  totalCount.textContent = todos.length;
  completedCount.textContent = todos.filter((todo) => todo.completed).length;

  // 显示空状态
  if (todos.length === 0) {
    todoList.innerHTML = `
            <li class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div>还没有待办事项<br>添加一个开始吧！</div>
            </li>
        `;
    return;
  }

  // 渲染每个待办事项
  todos.forEach((todo) => {
    const li = document.createElement("li");
    li.className = `todo-item ${todo.completed ? "completed" : ""}`;

    li.innerHTML = `
            <input type="checkbox"
                   class="todo-checkbox"
                   ${todo.completed ? "checked" : ""}
                   onchange="toggleTodo(${todo.id})">
            <span class="todo-text">${escapeHtml(todo.text)}</span>
            <button class="delete-btn" onclick="deleteTodo(${todo.id})">删除</button>
        `;

    todoList.appendChild(li);
  });
}

// HTML 转义，防止 XSS 攻击
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// 事件监听
addBtn.addEventListener("click", addTodo);

todoInput.addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    addTodo();
  }
});

// 添加键盘快捷键支持
document.addEventListener("keydown", function (e) {
  // Esc 清空输入框
  if (e.key === "Escape") {
    todoInput.value = "";
    todoInput.blur();
  }
});
