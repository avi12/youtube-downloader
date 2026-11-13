import { required } from "@/lib/required";
import App from "./App.svelte";
import "./theme.css";
import { mount } from "svelte";

mount(App, { target: required(document.getElementById("app")) });
