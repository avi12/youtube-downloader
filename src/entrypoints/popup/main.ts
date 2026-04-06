import App from "./App.svelte";
import { mount } from "svelte";

const elApp = document.getElementById("app")!;

mount(App, { target: elApp });
