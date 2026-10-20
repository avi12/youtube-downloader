import { mount } from "svelte";
import App from "./App.svelte";
import "./theme.css";

mount(App, { target: document.getElementById("app")! });
