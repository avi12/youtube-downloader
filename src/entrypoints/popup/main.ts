import App from "./App.svelte";
import "./theme.css";
import { mount } from "svelte";

mount(App, { target: document.getElementById("app")! });
